// Product data — RFRP Trackout Mat (construction-entrance mud-control product)
// Plausible spec data; numbers illustrative — RFRP to confirm before publication.

const RF_PRODUCT = {
  sku: 'RF-TM-810',
  family: 'Treadsafe™',
  name: 'Trackout Mat',
  brand: 'RFRP',
  tagline: 'Knocks mud off tires before they hit the road. Won\u2019t curl, crack, or wash out.',
  hero_caption: '8\u2032 \u00d7 10\u2032 modular trackout mat \u00b7 1 panel',
  rev: 'Rev. 04 \u00b7 04/2026',
  doc_id: 'DS-TM-810-04',
  pages: '8 pages',

  intro: 'The RFRP Trackout Mat is a heavy-duty construction-entrance pad engineered to dislodge mud, gravel, and debris from haul-truck tires before they leave the site. Cast from 100% recycled tire rubber, it replaces single-use crushed-stone aprons that wash out in a season, eliminates the SWPPP violations that come with off-site sediment tracking, and rolls into place in under twenty minutes with no specialty crew.',

  highlights: [
    { kicker: 'Material', value: '100% recycled tire rubber' },
    { kicker: 'Footprint', value: '8\u2032 \u00d7 10\u2032 \u00b7 link to any length' },
    { kicker: 'Service life', value: '8+ years on active sites' },
    { kicker: 'Origin', value: 'Made in Lockport, NY \u00b7 USA' },
  ],

  specs: [
    {
      group: 'Dimensions (per panel)',
      rows: [
        ['Overall length', '120 in', '3,048 mm'],
        ['Overall width', '96 in', '2,438 mm'],
        ['Panel thickness', '1.50 in', '38 mm'],
        ['Knob (cleat) height', '0.75 in', '19 mm'],
        ['Knob pattern', 'Staggered, 3" o.c.', '76 mm o.c.'],
        ['Panel weight', '385 lb', '174.6 kg'],
      ],
    },
    {
      group: 'Site & load ratings',
      rows: [
        ['Design vehicle', 'Class 8 dump / haul truck', '\u2014'],
        ['Single-axle load', '24,000 lb', '10,886 kg'],
        ['Tandem-axle load', '40,000 lb', '18,144 kg'],
        ['Recommended apron length', '50 ft minimum', '15.2 m'],
        ['Daily traffic capacity', 'Up to 400 truck passes', '\u2014'],
        ['Linkable run', 'Up to 200 ft', '61 m'],
      ],
    },
    {
      group: 'Material properties',
      rows: [
        ['Composition', '100% recycled tire rubber', '\u2014'],
        ['Binder', 'MDI polyurethane, low-VOC', '\u2014'],
        ['Density', '62 lb/ft\u00b3', '993 kg/m\u00b3'],
        ['Shore A hardness', '74 \u00b1 3', '\u2014'],
        ['Tensile strength (ASTM D412)', '1,180 psi', '8.1 MPa'],
        ['Service temp range', '\u221240 to +180 \u00b0F', '\u221240 to +82 \u00b0C'],
      ],
    },
    {
      group: 'Compliance & sustainability',
      rows: [
        ['EPA SWPPP \u00a7 BMP', 'Stabilized construction entrance', 'Conforming'],
        ['CWA NPDES', 'Sediment-control compliant', '\u2014'],
        ['Slip resistance (ASTM C1028, wet)', 'COF 0.79', 'High traction'],
        ['LEED contribution', 'MR Credits 4 & 5', 'Recycled & regional'],
        ['GreenSpec\u00ae listed', 'Yes', '\u2014'],
        ['Buy American Act', 'Compliant', '\u2014'],
      ],
    },
  ],

  install: {
    time: '15\u201320 min per panel',
    crew: '2 people + skid-steer or loader',
    tools: ['Tape measure', 'Chalk line', 'Skid-steer or loader with forks', '4\u00d7 link pins per joint (supplied)', '8 lb sledge', 'Shovel + rake (for sub-base)', 'PPE: hi-viz vest, gloves, safety glasses, steel-toe'],
    notes: 'Read all steps before beginning. Sub-base must be compacted earth or crushed stone, free of standing water and debris larger than 2". Grade should not exceed 5%. Coordinate site-entrance closure or flagging before staging panels.',
    steps: [
      {
        n: 1,
        title: 'Prep the sub-base',
        body: 'Identify the site exit point. Strip vegetation and topsoil from the apron footprint (10 ft wide \u00d7 50 ft minimum). Compact with a vibratory plate or roller pass. Crown the centerline 1\u20132% for drainage. Confirm grade does not exceed 5%.',
        callout: 'STOP if sub-base contains rock fragments > 2" or standing water.',
      },
      {
        n: 2,
        title: 'Snap the layout',
        body: 'Snap a chalk line down the centerline of the apron. Mark panel joints every 10 ft along the line. Confirm the apron centerline aligns with the haul road on both sides.',
      },
      {
        n: 3,
        title: 'Set the first panel',
        body: 'Using a skid-steer or loader with forks, lift the first panel from its molded fork pockets. Lower into place at the road-side end of the apron, knob-side up. Align the long edge with the chalk line. Two ground crew guide placement \u2014 stand clear of the load.',
        callout: '385 lb per panel. Never lift by hand.',
      },
      {
        n: 4,
        title: 'Link adjacent panels',
        body: 'Lower the next panel into position with its short edge butted against the first. Align the four molded link channels. Drive a steel link pin into each channel using the 8 lb sledge until the head seats flush. Repeat for each joint.',
        callout: '4 link pins per joint. Drive flush \u2014 do not overdrive.',
      },
      {
        n: 5,
        title: 'Stabilize the edges',
        body: 'Backfill the long edges of the apron with 2\u20133" of compacted crushed stone, flush to the top of the panel. This locks the run laterally and prevents undercutting from runoff. Rake smooth so there is no lip at the road side.',
        callout: 'No lip > 1/2" at the road interface.',
      },
      {
        n: 6,
        title: 'Verify & open the entrance',
        body: 'Walk the apron. Confirm all link pins are seated and that adjacent panels are flush within 1/4". Drive a loaded haul truck across at 5 mph as a final check \u2014 listen for any panel chatter. Record install date and SKU on the back of this guide. Remove flagging and reopen the entrance.',
      },
    ],
  },

  warnings: [
    'Do not install on grades steeper than 5%. Steeper site conditions require RFRP engineering review.',
    'Not rated for tracked vehicles (dozers, excavators on tracks). Use Treadsafe Crane Mats for tracked equipment.',
    'Inspect weekly. Replace any panel showing knob wear > 50%, link-channel tearing, or visible reinforcement.',
  ],

  warranty: '8-year limited warranty against manufacturing defect. Full terms at rfrp.com/warranty.',
};

window.RF_PRODUCT = RF_PRODUCT;
