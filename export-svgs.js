const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, 'src/renderer/sidebar/worktree-tab-icons.js');
const OUTPUT_DIR  = 'C:/Repos/images';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SIZE        = 64; // 16 * 4x scale

// Dark theme color values from styles.css
const COLORS = {
  green:      '#a6e3a1',
  yellow:     '#f9e2af',
  red:        '#f38ba8',
  accent:     '#89b4fa',
  peach:      '#fab387',
  'text-muted': '#6c7086',
};

// All colors each icon can appear in, derived from worktree-tab-dot-state.js
const PIPELINE_COLORS = ['yellow', 'red', 'green', 'accent']; // running, failed, succeeded, waiting
const ICON_COLORS = {
  BIN_ICON_SVG:                  ['text-muted'],
  DOT_COMMIT_PUSH_SVG:           ['green'],
  DOT_CREATE_PR_SVG:             ['accent'],
  DOT_OPEN_PR_SVG:               ['accent', 'green', 'red', 'peach', 'yellow'],
  DOT_COMPLETE_PR_SVG:           ['green'],
  DOT_RESOLVE_TASK_SVG:          ['green'],
  DOT_OPEN_TASK_SVG:             ['accent'],
  DOT_SWITCH_SVG:                ['text-muted'],
  DOT_DONE_SWITCH_SVG:           ['green'],
  DOT_DONE_SVG:                  ['green'],
  DOT_PIPELINE_SVG:              PIPELINE_COLORS,
  DOT_COMPLETE_TASK_RUNNING_SVG: PIPELINE_COLORS,
  DOT_TASK_DONE_RUNNING_SVG:     PIPELINE_COLORS,
  INSTALL_BTN_SVG:               ['text-muted'],
  INSTALL_PIPELINE_RUNNING_SVG:  ['yellow'],
};

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const source = fs.readFileSync(SOURCE_FILE, 'utf8');
  const svgs = {};
  const regex = /const\s+(\w+_SVG)\s*=\s*'(<svg[\s\S]+?<\/svg>)'/g;
  let m;
  while ((m = regex.exec(source)) !== null) {
    svgs[m[1]] = m[2];
  }
  console.log(`Found ${Object.keys(svgs).length} SVGs`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: SIZE, height: SIZE },
  });

  const page = await browser.newPage();

  for (const [name, svgRaw] of Object.entries(svgs)) {
    const colors = ICON_COLORS[name] || ['text-muted'];

    // Strip fixed width/height so CSS controls size
    const svgBase = svgRaw
      .replace(/(<svg[^>]*)\s+width="\d+"/, '$1')
      .replace(/(<svg[^>]*)\s+height="\d+"/, '$1');

    for (const colorName of colors) {
      const hex = COLORS[colorName];

      const svg = svgBase
        .replace(/\bstroke="currentColor"/g, `stroke="${hex}"`)
        .replace(/\bfill="currentColor"/g,   `fill="${hex}"`);

      const html = `<!DOCTYPE html><html><head><style>
        * { margin:0; padding:0; }
        html, body { width:${SIZE}px; height:${SIZE}px; background:#1e1e2e; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        svg { width:${SIZE}px; height:${SIZE}px; }
      </style></head><body>${svg}</body></html>`;

      await page.setContent(html, { waitUntil: 'load' });

      const suffix = colors.length > 1 ? `_${colorName}` : '';
      const outPath = path.join(OUTPUT_DIR, `${name}${suffix}.png`);
      await page.screenshot({ path: outPath });
      console.log(`Saved: ${path.basename(outPath)}`);
    }
  }

  await browser.close();
  console.log('Done.');
})();
