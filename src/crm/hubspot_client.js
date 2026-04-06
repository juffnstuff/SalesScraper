/**
 * HubSpot CRM Client
 * Pushes qualified prospects as Suspects with full project context.
 * Handles contact creation, company association, and task creation.
 */

const https = require('https');

class HubSpotClient {
  constructor(config = {}) {
    this.accessToken = config.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;
    this.baseUrl = 'https://api.hubapi.com';
    this.rateLimitDelay = 200;
    this.lastRequestTime = 0;
  }

  /**
   * Push a qualified prospect to HubSpot
   * Creates contact, company, and follow-up task
   */
  async pushProspect(contact, project, rep) {
    // Step 1: Check for existing contact
    const existing = await this.findExistingContact(contact);
    if (existing) {
      console.log(`    Skipping duplicate: ${contact.firstName} ${contact.lastName} (${contact.company})`);
      return { action: 'skipped', reason: 'duplicate', existingId: existing.id };
    }

    // Step 2: Find or create company
    const companyId = await this._findOrCreateCompany(contact, project);

    // Step 3: Create contact
    const contactId = await this._createContact(contact, project, rep);
    if (!contactId) return { action: 'failed', reason: 'contact creation failed' };

    // Step 4: Associate contact with company
    if (companyId) {
      await this._associateContactToCompany(contactId, companyId);
    }

    // Step 5: Create follow-up task
    await this._createTask(contactId, project, rep);

    return { action: 'created', contactId, companyId };
  }

  /**
   * Search for existing contact by email OR name+company
   */
  async findExistingContact(contact) {
    // Search by email first
    if (contact.email) {
      const byEmail = await this._searchContacts('email', contact.email);
      if (byEmail) return byEmail;
    }

    // Search by name + company
    const query = `${contact.firstName} ${contact.lastName}`;
    const byName = await this._searchContacts('query', query);
    if (byName && byName.properties?.company === contact.company) {
      return byName;
    }

    return null;
  }

  async _searchContacts(field, value) {
    try {
      const body = field === 'email' ? {
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: 'EQ',
            value: value
          }]
        }],
        limit: 1
      } : {
        query: value,
        limit: 1
      };

      const response = await this._request('POST', '/crm/v3/objects/contacts/search', body);
      return response.results?.[0] || null;
    } catch (error) {
      return null;
    }
  }

  async _findOrCreateCompany(contact, project) {
    // Search for existing company
    try {
      const searchResult = await this._request('POST', '/crm/v3/objects/companies/search', {
        query: contact.company,
        limit: 1
      });

      if (searchResult.results?.[0]) {
        return searchResult.results[0].id;
      }
    } catch (error) {
      // Continue to create
    }

    // Create new company
    try {
      const companyData = {
        properties: {
          name: contact.company,
          state: contact.state || project.geography?.state || '',
          industry: this._mapProjectTypeToIndustry(project.projectType),
          description: `Identified by AI Prospecting Engine. Project: ${project.projectName}`
        }
      };

      const result = await this._request('POST', '/crm/v3/objects/companies', companyData);
      return result.id;
    } catch (error) {
      console.warn(`    Failed to create company "${contact.company}": ${error.message}`);
      return null;
    }
  }

  async _createContact(contact, project, rep) {
    try {
      const properties = {
        firstname: contact.firstName,
        lastname: contact.lastName,
        email: contact.email || '',
        phone: contact.phone || '',
        jobtitle: contact.title || '',
        company: contact.company,
        state: contact.state || project.geography?.state || '',
        lifecyclestage: 'subscriber',
        hs_lead_status: 'NEW'
      };

      // Add custom properties (these need to exist in HubSpot)
      if (rep.hubspotOwnerId) {
        properties.hubspot_owner_id = rep.hubspotOwnerId.toString();
      }

      // Store project context in notes
      properties.notes_last_updated = new Date().toISOString();

      const result = await this._request('POST', '/crm/v3/objects/contacts', { properties });
      return result.id;
    } catch (error) {
      console.warn(`    Failed to create contact: ${error.message}`);
      return null;
    }
  }

  async _associateContactToCompany(contactId, companyId) {
    try {
      await this._request(
        'PUT',
        `/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
        {}
      );
    } catch (error) {
      console.warn(`    Failed to associate contact ${contactId} with company ${companyId}`);
    }
  }

  async _createTask(contactId, project, rep) {
    try {
      const dueDate = this._calculateDueDate(project.bidDate);
      const priority = project.relevanceScore >= 85 ? 'HIGH' : 'MEDIUM';

      const taskData = {
        properties: {
          hs_task_subject: `[AI Lead] ${project.projectName} — ${project.owner || 'Unknown'}`,
          hs_task_body: [
            `Prospect identified by AI Prospecting Engine.`,
            `Project: ${project.projectName}`,
            `Type: ${project.projectType}`,
            `Location: ${project.geography?.city || ''}, ${project.geography?.state || ''}`,
            `Bid Date: ${project.bidDate || 'Unknown'}`,
            `Est. Value: ${project.estimatedValue ? '$' + project.estimatedValue.toLocaleString() : 'Unknown'}`,
            `ICP Score: ${project.relevanceScore}/100`,
            `Source: ${project.sourceUrl || project.source}`,
            project.scoringReasoning ? `\nAI Notes: ${project.scoringReasoning}` : ''
          ].filter(Boolean).join('\n'),
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: priority,
          hs_timestamp: new Date().toISOString()
        }
      };

      if (rep.hubspotOwnerId) {
        taskData.properties.hubspot_owner_id = rep.hubspotOwnerId.toString();
      }

      if (dueDate) {
        taskData.properties.hs_task_due_date = dueDate;
      }

      const result = await this._request('POST', '/crm/v3/objects/tasks', taskData);

      // Associate task with contact
      if (result.id && contactId) {
        await this._request(
          'PUT',
          `/crm/v3/objects/tasks/${result.id}/associations/contacts/${contactId}/task_to_contact`,
          {}
        );
      }

      return result.id;
    } catch (error) {
      console.warn(`    Failed to create task: ${error.message}`);
      return null;
    }
  }

  _calculateDueDate(bidDate) {
    if (bidDate) {
      const bid = new Date(bidDate);
      if (!isNaN(bid.getTime())) {
        // 2 weeks before bid date
        bid.setDate(bid.getDate() - 14);
        if (bid > new Date()) {
          return bid.toISOString().split('T')[0];
        }
      }
    }
    // Default: 7 days from now
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  }

  _mapProjectTypeToIndustry(projectType) {
    const type = (projectType || '').toLowerCase();
    if (type.includes('highway') || type.includes('dot') || type.includes('road')) return 'GOVERNMENT_ADMINISTRATION';
    if (type.includes('municipal') || type.includes('government')) return 'GOVERNMENT_ADMINISTRATION';
    if (type.includes('commercial')) return 'CONSTRUCTION';
    if (type.includes('parking')) return 'FACILITIES_SERVICES';
    if (type.includes('utility')) return 'UTILITIES';
    return 'CONSTRUCTION';
  }

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async _request(method, endpoint, body = null) {
    await this._rateLimit();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.hubapi.com',
        path: endpoint,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429) {
            const retryAfter = parseInt(res.headers['retry-after'] || '10') * 1000;
            setTimeout(() => {
              this._request(method, endpoint, body).then(resolve).catch(reject);
            }, retryAfter);
            return;
          }

          if (res.statusCode >= 400) {
            reject(new Error(`HubSpot API error ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }

          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve({});
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

module.exports = HubSpotClient;
