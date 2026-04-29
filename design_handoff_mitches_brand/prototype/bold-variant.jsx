// BoldVariant — rebel-brand, editorial, high contrast.
// Deep navy bg, dark-red accent, white type.

function BoldVariant({ tab, setTab }) {
  const P = RF_PRODUCT;
  // Sky blue + white + salmon, Mitch's vibe but clean (no western/slab).
  const C = {
    bg: '#0e3447',
    bgDeep: '#08222e',
    ink: '#ffffff',
    inkDim: 'rgba(255,255,255,0.74)',
    inkFaint: 'rgba(255,255,255,0.36)',
    rule: 'rgba(168,216,232,0.30)',
    yellow: '#a8d8e8',         // sky blue
    orange: '#f08977',         // salmon
    olive: '#08222e',
    paper: '#ffffff',
    paperInk: '#0e3447',
  };

  return (
    <div style={{
      width: '100%', minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: "'Inter Tight', sans-serif",
    }}>
      {/* Top crawler bar */}
      <div style={{
        background: C.yellow, color: C.bg,
        padding: '8px 32px',
        fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24,
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        <span>★ Made in Lockport, NY</span>
        <span>{P.doc_id}</span>
        <span>Won't Crack · Won't Crumble · Won't Corrode</span>
        <span>{P.rev}</span>
        <span>★ A Rebel Brand</span>
      </div>

      {/* Hero — asymmetric */}
      <div style={{ position: 'relative', padding: '40px 48px 48px', borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <RFLogo color={C.ink} accent={C.yellow} size={42} />
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', fontSize: 11,
                        fontFamily: "'JetBrains Mono', monospace", color: C.inkDim,
                        letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span>{P.pages}</span>
            <span style={{ width: 1, height: 12, background: C.rule }}></span>
            <span style={{ color: C.yellow }}>● live</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '8fr 4fr', gap: 32, alignItems: 'flex-end' }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              letterSpacing: '0.18em', textTransform: 'uppercase', color: C.yellow,
              marginBottom: 18,
            }}>
              <span style={{ width: 24, height: 1, background: C.yellow }}></span>
              {P.family} Family · SKU {P.sku}
            </div>
            <h1 style={{
              fontFamily: "'Yellowtail', cursive", fontWeight: 400,
              fontSize: 168, lineHeight: 0.85, margin: 0,
              letterSpacing: '-0.005em', color: C.yellow,
              transform: 'rotate(-2deg)', transformOrigin: 'left',
            }}>
              Trackout <span style={{ fontStyle: 'italic' }}>Mats</span>
            </h1>
            <div style={{
              marginTop: 18,
              fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14,
              letterSpacing: '0.20em', textTransform: 'uppercase', color: C.orange,
            }}>Since 1995 · Lockport, NY</div>
            <div style={{
              marginTop: 24, fontSize: 19, lineHeight: 1.45, maxWidth: 580,
              color: C.ink, fontWeight: 400,
            }}>
              {P.tagline}
            </div>
          </div>

          {/* Stats stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {P.highlights.slice(0, 3).map((h, i) => (
              <div key={i} style={{
                borderTop: `1px solid ${C.rule}`,
                paddingTop: 12,
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  letterSpacing: '0.18em', textTransform: 'uppercase', color: C.yellow,
                  marginBottom: 4,
                }}>{h.kicker}</div>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 22,
                  textTransform: 'uppercase', letterSpacing: '0.01em',
                  color: C.ink, lineHeight: 1.05,
                }}>{h.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hero placeholder strip — full bleed */}
      <div style={{
        height: 280,
        background: `repeating-linear-gradient(135deg, #1d5673, #1d5673 18px, #16475f 18px, #16475f 36px)`,
        borderBottom: `1px solid ${C.rule}`,
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          letterSpacing: '0.2em', textTransform: 'uppercase', color: C.inkDim,
          padding: '8px 16px', border: `1px solid ${C.rule}`, borderRadius: 2,
          background: C.bg,
        }}>
          [ FULL-BLEED PRODUCT PHOTO · {P.hero_caption} ]
        </div>
        {/* Corner crop marks */}
        {[
          { top: 12, left: 12 },
          { top: 12, right: 12 },
          { bottom: 12, left: 12 },
          { bottom: 12, right: 12 },
        ].map((p, i) => (
          <div key={i} style={{
            position: 'absolute', ...p, width: 16, height: 16,
            borderColor: C.yellow,
            borderStyle: 'solid',
            borderWidth: `${p.top !== undefined ? '1.5px' : 0} ${p.right !== undefined ? '1.5px' : 0} ${p.bottom !== undefined ? '1.5px' : 0} ${p.left !== undefined ? '1.5px' : 0}`,
          }}></div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', padding: '0 48px',
        background: C.bg, borderBottom: `1px solid ${C.rule}`,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        {[
          { k: 'spec', label: '01 — Spec Sheet' },
          { k: 'install', label: '02 — Install Guide' },
        ].map(({ k, label }) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: tab === k ? C.yellow : 'transparent',
            color: tab === k ? C.bg : C.inkDim,
            border: 'none', cursor: 'pointer',
            padding: '20px 28px',
            fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 15,
            textTransform: 'uppercase', letterSpacing: '0.14em',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }}></div>
      </div>

      {/* Body */}
      {tab === 'spec' ? <BoldSpecBody P={P} C={C} /> : <BoldInstallBody P={P} C={C} />}

      {/* Footer — rebel mantra */}
      <div style={{
        background: C.yellow, color: C.bg, padding: '32px 48px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 32,
          textTransform: 'uppercase', letterSpacing: '0.01em', lineHeight: 1,
        }}>
          Rules are made <span style={{ fontStyle: 'italic', fontWeight: 400 }}>to be broken.</span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
          letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'right',
        }}>
          rfrp.com<br />1.866.262.5546
        </div>
      </div>
    </div>
  );
}

function BoldSpecBody({ P, C }) {
  return (
    <div style={{ padding: '48px 48px 56px' }}>
      {/* Pull quote intro */}
      <div style={{
        display: 'grid', gridTemplateColumns: '120px 1fr', gap: 32, marginBottom: 56,
        alignItems: 'flex-start',
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 96,
          color: C.yellow, lineHeight: 0.8,
        }}>“</div>
        <p style={{
          margin: 0, fontSize: 22, lineHeight: 1.4, color: C.ink, fontWeight: 400,
          fontFamily: "'Oswald', sans-serif", textTransform: 'uppercase', letterSpacing: '0.01em',
        }}>{P.intro}</p>
      </div>

      {/* Spec tables — full width with yellow group headers */}
      {P.specs.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 40 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16,
          }}>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 11,
              letterSpacing: '0.2em', textTransform: 'uppercase', color: C.bg,
              background: C.yellow, padding: '4px 10px',
            }}>{String(gi + 1).padStart(2, '0')}</div>
            <h3 style={{
              margin: 0, fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 28,
              textTransform: 'uppercase', letterSpacing: '0.01em', color: C.ink,
            }}>{group.group}</h3>
            <div style={{ flex: 1, height: 1, background: C.rule, marginLeft: 8 }}></div>
          </div>

          <div>
            {group.rows.map((r, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '5fr 4fr 3fr',
                padding: '14px 0', borderBottom: `1px solid ${C.rule}`,
                alignItems: 'baseline',
              }}>
                <div style={{ fontSize: 15, color: C.ink }}>{r[0]}</div>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 22,
                  textTransform: 'uppercase', color: C.yellow, letterSpacing: '0.005em',
                }}>{r[1]}</div>
                <div style={{ fontSize: 13, color: C.inkDim, fontFamily: "'JetBrains Mono', monospace" }}>{r[2]}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Drawing — boxed, contrasting */}
      <div style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 28,
          textTransform: 'uppercase', color: C.ink, marginBottom: 16,
        }}>Dimensional Drawing</div>
        <div style={{
          height: 320, background: C.paper, color: C.paperInk,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
            letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(24,24,28,0.5)',
            border: '1px dashed rgba(24,24,28,0.4)', padding: '8px 14px',
          }}>[ ORTHOGRAPHIC VIEWS · TOP / SIDE / FRONT — scale 1:8 ]</div>
        </div>
      </div>
    </div>
  );
}

function BoldInstallBody({ P, C }) {
  const I = P.install;
  return (
    <div style={{ padding: '48px 48px 56px' }}>
      {/* Stat strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        marginBottom: 48, borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}`,
      }}>
        {[
          ['Time', I.time],
          ['Crew', I.crew],
          ['Steps', `${I.steps.length}`],
        ].map(([k, v], i) => (
          <div key={i} style={{
            padding: '24px 24px 24px 0',
            borderRight: i < 2 ? `1px solid ${C.rule}` : 'none',
            paddingLeft: i > 0 ? 24 : 0,
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              letterSpacing: '0.2em', textTransform: 'uppercase', color: C.yellow,
              marginBottom: 8,
            }}>{k}</div>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 56,
              textTransform: 'uppercase', color: C.ink, lineHeight: 0.9,
              letterSpacing: '-0.01em',
            }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Tools — chips */}
      <div style={{ marginBottom: 48 }}>
        <h3 style={boldH3(C)}>Tools & Materials</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {I.tools.map((t, i) => (
            <div key={i} style={{
              padding: '10px 16px', border: `1px solid ${C.rule}`,
              fontSize: 13, color: C.ink,
              fontFamily: "'Inter Tight', sans-serif",
            }}>
              <span style={{ color: C.yellow, marginRight: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* Pre-flight banner */}
      <div style={{
        background: C.yellow, color: C.bg, padding: '24px 28px', marginBottom: 48,
        display: 'grid', gridTemplateColumns: '160px 1fr', gap: 24, alignItems: 'flex-start',
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 24,
          textTransform: 'uppercase', lineHeight: 0.95, letterSpacing: '0.01em',
        }}>Read first.</div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, fontWeight: 500 }}>{I.notes}</p>
      </div>

      {/* Steps — alternating, large numerals */}
      <h3 style={boldH3(C)}>Procedure</h3>
      {I.steps.map((step, i) => {
        const flip = i % 2 === 1;
        return (
          <div key={step.n} style={{
            display: 'grid',
            gridTemplateColumns: flip ? '1fr 280px' : '280px 1fr',
            gap: 32,
            padding: '32px 0',
            borderTop: `1px solid ${C.rule}`,
            alignItems: 'flex-start',
          }}>
            {!flip && <BoldStepDiagram step={step} C={C} />}
            <div>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12,
              }}>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 88,
                  color: C.yellow, lineHeight: 0.85, letterSpacing: '-0.02em',
                }}>{String(step.n).padStart(2, '0')}</div>
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 28,
                  textTransform: 'uppercase', color: C.ink, lineHeight: 1.05,
                  letterSpacing: '0.005em',
                }}>{step.title}</div>
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: C.inkDim, maxWidth: 580 }}>{step.body}</p>
              {step.callout && (
                <div style={{
                  marginTop: 16, padding: '10px 14px', background: 'rgba(240,137,119,0.16)',
                  borderLeft: `3px solid ${C.yellow}`,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                  color: C.yellow, letterSpacing: '0.04em',
                }}>⚠  {step.callout}</div>
              )}
            </div>
            {flip && <BoldStepDiagram step={step} C={C} />}
          </div>
        );
      })}

      {/* Warnings — black bordered yellow strip */}
      <div style={{ marginTop: 56 }}>
        <h3 style={boldH3(C)}>⚠  Warnings & Limits</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {P.warnings.map((w, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr', gap: 16,
              padding: '16px 0', borderBottom: `1px solid ${C.rule}`,
              alignItems: 'baseline',
            }}>
              <div style={{
                fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 28,
                color: C.yellow, lineHeight: 1,
              }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 15, lineHeight: 1.55, color: C.ink }}>{w}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Warranty card */}
      <div style={{
        marginTop: 40, padding: '28px 32px',
        border: `2px solid ${C.yellow}`,
        display: 'grid', gridTemplateColumns: '160px 1fr', gap: 24, alignItems: 'center',
      }}>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 64,
          color: C.yellow, lineHeight: 0.85, letterSpacing: '-0.02em',
        }}>10<span style={{ fontSize: 22, marginLeft: 4 }}>YR</span></div>
        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 18,
            textTransform: 'uppercase', letterSpacing: '0.04em', color: C.ink,
            marginBottom: 6,
          }}>Limited Warranty</div>
          <p style={{ margin: 0, fontSize: 14, color: C.inkDim, lineHeight: 1.5 }}>{P.warranty}</p>
        </div>
      </div>
    </div>
  );
}

function BoldStepDiagram({ step, C }) {
  return (
    <div style={{
      height: 200, background: '#16475f', border: `1px solid ${C.rule}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `repeating-linear-gradient(135deg, transparent, transparent 12px, rgba(240,137,119,0.07) 12px, rgba(240,137,119,0.07) 24px)`,
      }}></div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        letterSpacing: '0.2em', textTransform: 'uppercase', color: C.yellow,
        padding: '6px 10px', border: `1px solid ${C.yellow}`,
        position: 'relative',
      }}>STEP {String(step.n).padStart(2, '0')} · DIAGRAM</div>
    </div>
  );
}

function boldH3(C) {
  return {
    margin: '0 0 20px 0',
    fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 28,
    textTransform: 'uppercase', letterSpacing: '0.01em', color: C.ink,
  };
}

Object.assign(window, { BoldVariant });
