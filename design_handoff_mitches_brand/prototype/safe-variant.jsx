// SafeVariant — engineering doc / B2B credibility first.
// Light paper feel, technical typography, structured grid.
// Dark-mode toggle inverts to charcoal background.

function SafeVariant({ tab, setTab, dark }) {
  const P = RF_PRODUCT;

  // Sky blue + white + salmon. Clean Mitch's vibe — no western/slab type.
  const palette = dark ? {
    bg: '#0e3447',           // deep teal-blue
    paper: '#16475f',
    ink: '#ffffff',
    inkDim: 'rgba(255,255,255,0.74)',
    inkFaint: 'rgba(255,255,255,0.40)',
    rule: 'rgba(168,216,232,0.32)',
    accent: '#a8d8e8',        // sky blue
    accentWarm: '#f08977',    // salmon
    chip: 'rgba(240,137,119,0.18)',
    placeholderBg: '#1d5673',
    placeholderStripe: 'rgba(255,255,255,0.06)',
    isDark: true,
  } : {
    bg: '#f0f7fa',           // very pale sky tint
    paper: '#ffffff',
    ink: '#0e3447',
    inkDim: 'rgba(14,52,71,0.70)',
    inkFaint: 'rgba(14,52,71,0.38)',
    rule: 'rgba(14,52,71,0.18)',
    accent: '#1a6b87',        // deeper sky blue (passes AA on white)
    accentWarm: '#c45947',    // salmon (darkened for AA on white)
    chip: 'rgba(196,89,71,0.10)',
    placeholderBg: '#e8f1f5',
    placeholderStripe: 'rgba(14,52,71,0.05)',
    isDark: false,
  };

  return (
    <div style={{
      width: '100%', minHeight: '100%',
      background: palette.bg,
      fontFamily: "'Inter Tight', sans-serif",
      color: palette.ink,
      padding: '0',
    }}>
      {/* Top utility bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 56px', borderBottom: `1px solid ${palette.rule}`,
        fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: palette.inkDim, fontFamily: "'JetBrains Mono', monospace",
      }}>
        <span>{P.doc_id} · {P.rev}</span>
        <span>RFRP · RubberForm Recycled Products, LLC · Lockport, NY</span>
        <span>{P.pages}</span>
      </div>

      {/* Header */}
      <div style={{ padding: '40px 56px 28px', background: palette.paper }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <RFLogo color={palette.ink} accent={palette.accent} size={42} />
          <div style={{ textAlign: 'right', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: palette.inkDim, lineHeight: 1.6 }}>
            <div style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>Document Type</div>
            <div style={{ fontSize: 13, color: palette.ink, marginTop: 2 }}>Spec Sheet & Install Guide</div>
          </div>
        </div>

        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 36, alignItems: 'flex-end' }}>
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: palette.accent, marginBottom: 10,
            }}>
              {P.family} Family · SKU {P.sku}
            </div>
            <h1 className="rf-display" style={{
              fontFamily: "'Oswald', sans-serif", fontWeight: 700,
              fontSize: 64, lineHeight: 0.96, margin: 0,
              textTransform: 'uppercase', letterSpacing: '0.005em',
            }}>
              {P.name}
            </h1>
            <p style={{
              marginTop: 18, marginBottom: 0, fontSize: 17, lineHeight: 1.5,
              maxWidth: 540, color: palette.inkDim, fontWeight: 400,
            }}>
              {P.tagline}
            </p>
          </div>

          {/* Hero product placeholder */}
          <SafePlaceholder palette={palette} label="PRODUCT HERO" caption={P.hero_caption} h={220} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, padding: '0 56px',
        background: palette.paper, borderTop: `1px solid ${palette.rule}`,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        {[
          { k: 'spec', label: 'Spec Sheet' },
          { k: 'install', label: 'Install Guide' },
        ].map(({ k, label }) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '18px 28px 18px 0', marginRight: 28,
            fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 14,
            textTransform: 'uppercase', letterSpacing: '0.12em',
            color: tab === k ? palette.ink : palette.inkFaint,
            borderBottom: `2px solid ${tab === k ? palette.accent : 'transparent'}`,
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }}></div>
        <div style={{
          alignSelf: 'center', fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
          color: palette.inkDim, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          {tab === 'spec' ? 'Section 1 of 2' : 'Section 2 of 2'}
        </div>
      </div>

      {/* Body */}
      <div style={{ background: palette.paper, padding: '36px 56px 56px' }}>
        {tab === 'spec' ? <SafeSpecBody P={P} palette={palette} /> : <SafeInstallBody P={P} palette={palette} />}
      </div>

      {/* Footer */}
      <div style={{
        background: palette.bg,
        padding: '20px 56px', borderTop: `1px solid ${palette.rule}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: palette.inkDim,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        <span>rfrp.com · 1.866.262.5546</span>
        <span>© RFRP · RubberForm Recycled Products, LLC · {P.doc_id}</span>
      </div>
    </div>
  );
}

function SafePlaceholder({ palette, label, caption, h = 200 }) {
  return (
    <div style={{
      height: h, borderRadius: 4,
      background: `repeating-linear-gradient(135deg, ${palette.placeholderBg}, ${palette.placeholderBg} 12px, ${palette.placeholderStripe} 12px, ${palette.placeholderStripe} 24px)`,
      border: `1px solid ${palette.rule}`,
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: palette.inkDim,
        background: palette.paper, padding: '4px 10px', borderRadius: 2,
      }}>[ {label} ]</div>
      {caption && (
        <div style={{ fontSize: 11, color: palette.inkFaint, fontStyle: 'italic' }}>{caption}</div>
      )}
    </div>
  );
}

function SafeSpecBody({ P, palette }) {
  return (
    <div>
      {/* Intro */}
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 36, marginBottom: 40 }}>
        <div>
          <SectionLabel palette={palette}>Overview</SectionLabel>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: palette.ink, margin: 0 }}>{P.intro}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
                      border: `1px solid ${palette.rule}`, borderRadius: 4, overflow: 'hidden' }}>
          {P.highlights.map((h, i) => (
            <div key={i} style={{
              padding: '18px 20px',
              borderRight: i % 2 === 0 ? `1px solid ${palette.rule}` : 'none',
              borderBottom: i < 2 ? `1px solid ${palette.rule}` : 'none',
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.inkDim,
                marginBottom: 6,
              }}>{h.kicker}</div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500,
                            fontSize: 17, textTransform: 'uppercase', letterSpacing: '0.01em',
                            color: palette.ink, lineHeight: 1.15 }}>{h.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Spec tables */}
      {P.specs.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 32 }}>
          <SectionLabel palette={palette}>{group.group}</SectionLabel>
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 14,
            fontFamily: "'Inter Tight', sans-serif",
          }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${palette.ink}` }}>
                <th style={tableHeadStyle(palette, 'left', '50%')}>Property</th>
                <th style={tableHeadStyle(palette, 'left', '28%')}>Value (US)</th>
                <th style={tableHeadStyle(palette, 'left', '22%')}>Metric / Notes</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${palette.rule}` }}>
                  <td style={{ padding: '10px 12px 10px 0', color: palette.inkDim }}>{r[0]}</td>
                  <td style={{ padding: '10px 12px 10px 0', color: palette.ink, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{r[1]}</td>
                  <td style={{ padding: '10px 0', color: palette.inkDim, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Drawing placeholder */}
      <div style={{ marginTop: 8 }}>
        <SectionLabel palette={palette}>Dimensional Drawing</SectionLabel>
        <SafePlaceholder palette={palette} label="DIMENSIONAL DRAWING (TOP / SIDE / FRONT)" caption="orthographic views with dimensions, scale 1:8" h={260} />
      </div>
    </div>
  );
}

function SafeInstallBody({ P, palette }) {
  const I = P.install;
  return (
    <div>
      {/* At-a-glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
                    border: `1px solid ${palette.rule}`, borderRadius: 4, marginBottom: 36 }}>
        {[
          ['Time required', I.time],
          ['Crew', I.crew],
          ['Tools', `${I.tools.length} items`],
        ].map(([k, v], i) => (
          <div key={i} style={{
            padding: '18px 20px',
            borderRight: i < 2 ? `1px solid ${palette.rule}` : 'none',
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: palette.inkDim,
              marginBottom: 6,
            }}>{k}</div>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500,
                          fontSize: 18, textTransform: 'uppercase',
                          color: palette.ink }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Tools list */}
      <div style={{ marginBottom: 36 }}>
        <SectionLabel palette={palette}>Tools & Materials</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', columnCount: 2, columnGap: 32 }}>
          {I.tools.map((t, i) => (
            <li key={i} style={{
              fontSize: 14, padding: '8px 0', borderBottom: `1px solid ${palette.rule}`,
              color: palette.ink, breakInside: 'avoid', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 2, border: `1.5px solid ${palette.inkFaint}`,
                flexShrink: 0,
              }}></span>
              {t}
            </li>
          ))}
        </ul>
      </div>

      {/* Pre-flight notes */}
      <div style={{
        background: palette.chip, border: `1px solid ${palette.accent}`, borderLeft: `4px solid ${palette.accent}`,
        padding: '16px 20px', marginBottom: 40, borderRadius: 2,
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.accent,
          marginBottom: 6,
        }}>Before you begin</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: palette.ink }}>{I.notes}</p>
      </div>

      {/* Steps */}
      <SectionLabel palette={palette}>Installation Procedure</SectionLabel>
      {I.steps.map((step) => (
        <div key={step.n} style={{
          display: 'grid', gridTemplateColumns: '80px 1fr 220px', gap: 24,
          padding: '22px 0', borderBottom: `1px solid ${palette.rule}`,
        }}>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 56,
            color: palette.accent, lineHeight: 0.9, letterSpacing: '-0.02em',
          }}>{String(step.n).padStart(2, '0')}</div>
          <div>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 20,
              textTransform: 'uppercase', letterSpacing: '0.01em',
              color: palette.ink, marginBottom: 8,
            }}>{step.title}</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: palette.inkDim }}>{step.body}</p>
            {step.callout && (
              <div style={{
                marginTop: 12, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                color: palette.accent, letterSpacing: '0.04em',
              }}>⚠  {step.callout}</div>
            )}
          </div>
          <SafePlaceholder palette={palette} label={`STEP ${step.n} DIAGRAM`} h={140} />
        </div>
      ))}

      {/* Warnings */}
      <div style={{ marginTop: 36 }}>
        <SectionLabel palette={palette}>Warnings & Limits</SectionLabel>
        {P.warnings.map((w, i) => (
          <div key={i} style={{
            display: 'flex', gap: 14, padding: '12px 0',
            borderBottom: i < P.warnings.length - 1 ? `1px dashed ${palette.rule}` : 'none',
            fontSize: 14, color: palette.ink, lineHeight: 1.5,
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              fontWeight: 600, color: palette.accent, paddingTop: 2,
              letterSpacing: '0.08em', flexShrink: 0,
            }}>! {String(i + 1).padStart(2, '0')}</div>
            <div>{w}</div>
          </div>
        ))}
      </div>

      {/* Warranty */}
      <div style={{ marginTop: 36, padding: '20px 24px', background: palette.bg, borderRadius: 4 }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.inkDim,
          marginBottom: 6,
        }}>Warranty</div>
        <p style={{ margin: 0, fontSize: 14, color: palette.ink, lineHeight: 1.55 }}>{P.warranty}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children, palette }) {
  return (
    <div style={{
      fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12,
      letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.inkDim,
      marginBottom: 14, paddingBottom: 8, borderBottom: `2px solid ${palette.ink}`,
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    }}>
      <span>{children}</span>
    </div>
  );
}

function tableHeadStyle(palette, align, width) {
  return {
    textAlign: align, width,
    padding: '10px 12px 10px 0',
    fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 11,
    letterSpacing: '0.16em', textTransform: 'uppercase', color: palette.ink,
  };
}

Object.assign(window, { SafeVariant });
