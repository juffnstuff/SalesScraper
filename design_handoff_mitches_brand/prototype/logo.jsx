// Vintage surf-shop logo lockup for RFRP — inspired by mid-century surf-shop signage.
// Cursive script wordmark + block subtitle + small slab tagline, framed by a thin double border.

function RFLogo({
  color = '#a8d8e8',         // sky blue
  accent = '#f08977',         // salmon
  bg = 'transparent',
  size = 64,
  showFrame = true,
  showSince = true,
}) {
  // Wordmark uses a brushy script (Yellowtail-style — painted/handwritten). F's crossbar
  // extends across the rest of the word ending in a tapered point — like the t in Mitch's.
  const fontSize = size * 1.7;
  const wordmarkW = fontSize * 2.6; // approximate width of "RFRP" rendered

  return (
    <div style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: showFrame ? `${size * 0.28}px ${size * 0.55}px` : 0,
      background: bg,
    }}>
      {showFrame && (
        <React.Fragment>
          <div style={{
            position: 'absolute', inset: 0,
            borderTop: `2.5px solid ${color}`,
            borderBottom: `2.5px solid ${color}`,
            borderLeft: `2.5px solid ${color}`,
            borderRight: `2.5px solid ${color}`,
            // Mitch's "bow-tie" pinched ends — emulate via clip-path
            borderRadius: 4,
          }}></div>
          <div style={{
            position: 'absolute', inset: size * 0.1,
            border: `1.5px solid ${color}`,
            borderRadius: 2,
            opacity: 0.6,
          }}></div>
        </React.Fragment>
      )}

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        position: 'relative', zIndex: 1,
      }}>
        {/* RFRP wordmark — brushy script, with F's TOP FLAG extending right across like Mitch's t */}
        <div style={{
          position: 'relative',
          width: wordmarkW,
          height: fontSize * 0.95,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start',
        }}>
          <div style={{
            position: 'absolute', left: 0, top: 0,
            fontFamily: "'Yellowtail', 'Pacifico', cursive",
            fontSize,
            lineHeight: 0.95,
            color,
            letterSpacing: '0.01em',
            // thicken the brush stroke
            textShadow: `
              0.6px 0 0 ${color}, -0.6px 0 0 ${color},
              0 0.6px 0 ${color}, 0 -0.6px 0 ${color},
              0.6px 0.6px 0 ${color}, -0.6px -0.6px 0 ${color},
              0.6px -0.6px 0 ${color}, -0.6px 0.6px 0 ${color}
            `,
            whiteSpace: 'nowrap',
          }}>RFRP</div>

          {/* Hand-drawn flag stroke — passes through the MIDDLE (x-height) of RFRP letters,
              like the t crossbar in Mitch's that runs through the i/c/k bodies. Slightly wavy,
              tapered to a point at the right end. */}
          <svg
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              // Sits at the visual middle of the wordmark — through the bodies of R F R P
              top: fontSize * 0.42,
              // Starts inside the F (so it reads as part of the F flag, growing right)
              left: fontSize * 0.5,
              width: wordmarkW - fontSize * 0.3,
              height: fontSize * 0.18,
              overflow: 'visible',
            }}
          >
            {/* Hand-drawn wavy flag — thick on the left where it springs from the F,
                slight upward sweep with a gentle wobble, tapering to a point on the right */}
            <path
              d="
                M 0 6.5
                Q 4 5.8, 8 6.0
                Q 18 5.4, 28 5.6
                Q 42 4.9, 56 5.2
                Q 72 4.6, 88 4.7
                L 100 4.4
                L 100 5.0
                Q 88 5.3, 72 5.4
                Q 56 6.0, 42 5.8
                Q 28 6.5, 18 6.4
                Q 8 7.0, 4 7.0
                Q 1 7.2, 0 7.2
                Z
              "
              fill={color}
            />
          </svg>
        </div>

        {/* Recycled Products — Mitch's-style "SURF SHOP" treatment: clean condensed sans, all caps */}
        <div style={{
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 700,
          fontSize: size * 0.4,
          color,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginTop: size * 0.05,
          lineHeight: 1,
        }}>
          Recycled Products
        </div>

        {showSince && (
          <div style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 600,
            fontStyle: 'italic',
            fontSize: size * 0.32,
            color: accent,
            letterSpacing: '0.04em',
            marginTop: size * 0.16,
          }}>
            since 1995
          </div>
        )}
      </div>
    </div>
  );
}

function RFInlineMark({ color = '#a8d8e8', accent = '#f08977', size = 38 }) {
  return <RFLogo color={color} accent={accent} size={size * 0.7} showFrame={false} showSince={false} />;
}

// Wood-grain backdrop component (CSS-only mahogany planks)
function WoodPlanks({ children, style = {} }) {
  const wood = `
    repeating-linear-gradient(90deg,
      #2a1410 0px, #2a1410 1px,
      transparent 1px, transparent 220px),
    repeating-linear-gradient(0deg,
      rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 0.5px,
      transparent 0.5px, transparent 4px),
    radial-gradient(ellipse at 20% 30%, #4a261d 0%, transparent 55%),
    radial-gradient(ellipse at 80% 70%, #5a2e22 0%, transparent 60%),
    linear-gradient(180deg, #3d1f1a 0%, #2e1611 100%)
  `;
  return (
    <div style={{
      background: wood,
      backgroundBlendMode: 'normal, multiply, normal, normal, normal',
      ...style,
    }}>{children}</div>
  );
}

// Backwards compat — old code still imports these
function RFCircleArrows() { return null; }
function RFArchedWordmark() { return null; }
function RFWaveMark() { return null; }

Object.assign(window, { RFLogo, RFInlineMark, WoodPlanks, RFCircleArrows, RFArchedWordmark, RFWaveMark });
