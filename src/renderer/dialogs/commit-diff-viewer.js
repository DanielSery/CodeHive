/**
 * Renders a unified diff as a side-by-side table with context controls and line-level revert.
 * @param {HTMLElement} panel
 * @param {string} diff - unified diff text (from git diff -U<n>)
 * @param {object} opts
 * @param {function(Array)} [opts.onRevertLines] - called with [{newLineNum,newCount,oldLines}]
 * @param {function(number,number|null):Promise<string[]>} [opts.onExpandGap] - called with (startLine, endLine|null), returns lines
 */
let _gradSeq = 0;

export function renderFileDiff(panel, diff, { onRevertLines, onExpandGap } = {}) {
  panel.innerHTML = '';
  panel.className = panel.className.replace(/\bcommit-diff-panel--(split|inline)\b/g, '');
  panel.classList.add('commit-diff-panel--split');
  if (!diff || !diff.trim()) {
    panel.innerHTML = '<div class="commit-diff-empty">No diff available</div>';
    return;
  }

  // --- Parse unified diff into hunks ---
  const hunks = [];
  let hunk = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') ||
        line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('Binary')) {
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        hunk = { newStart: parseInt(m[3]), lines: [] };
        hunks.push(hunk);
      }
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) hunk.lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) hunk.lines.push({ type: 'del', text: line.slice(1) });
    else hunk.lines.push({ type: 'ctx', text: line.slice(1) });
  }

  // Compute the last new-file line number covered by each hunk
  for (const h of hunks) {
    let n = h.newStart;
    for (const l of h.lines) { if (l.type !== 'del') n++; }
    h.newEnd = n - 1;
  }

  // Group consecutive hunks whose line ranges overlap into display chunks
  const hunkGroups = [];
  let curGroup = [];
  for (const h of hunks) {
    if (curGroup.length === 0 || h.newStart <= curGroup[curGroup.length - 1].newEnd) {
      curGroup.push(h);
    } else {
      hunkGroups.push(curGroup);
      curGroup = [h];
    }
  }
  if (curGroup.length > 0) hunkGroups.push(curGroup);

  // --- Build rowGroups: gaps + merged lines per display chunk ---
  const rowGroups = [];

  // Edge before first chunk (lines 1..firstStart-1)
  if (hunkGroups.length > 0 && hunkGroups[0][0].newStart > 1) {
    rowGroups.push({ type: 'edge', gapStart: 1, gapEnd: hunkGroups[0][0].newStart - 1 });
  }

  for (let gi = 0; gi < hunkGroups.length; gi++) {
    if (gi > 0) {
      const prevGroup = hunkGroups[gi - 1];
      const gapStart = prevGroup[prevGroup.length - 1].newEnd + 1;
      const gapEnd   = hunkGroups[gi][0].newStart - 1;
      rowGroups.push({ type: 'sep', gapStart, gapEnd });
    }

    // Merge hunk lines, deduplicating context lines that overlap between hunks
    const seenCtx = new Set();
    const mergedLines = [];
    for (const h of hunkGroups[gi]) {
      let n = h.newStart;
      for (const l of h.lines) {
        if (l.type === 'ctx') {
          if (!seenCtx.has(n)) { seenCtx.add(n); mergedLines.push(l); }
          n++;
        } else {
          mergedLines.push(l);
          if (l.type === 'add') n++;
        }
      }
    }

    let newLineNum = hunkGroups[gi][0].newStart;
    let i = 0;
    while (i < mergedLines.length) {
      const line = mergedLines[i];
      if (line.type === 'ctx') {
        rowGroups.push({ type: 'ctx', text: line.text });
        newLineNum++;
        i++;
      } else {
        const dels = [], adds = [];
        const blockStart = newLineNum;
        while (i < mergedLines.length && mergedLines[i].type !== 'ctx') {
          if (mergedLines[i].type === 'del') dels.push(mergedLines[i].text);
          else adds.push(mergedLines[i].text);
          i++;
        }
        const pairs = [];
        for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
          pairs.push({ left: dels[j] ?? null, right: adds[j] ?? null });
        }
        rowGroups.push({
          type: 'change',
          pairs,
          dels,
          adds,
          changeData: { newLineNum: blockStart, newCount: adds.length, oldLines: dels }
        });
        newLineNum += adds.length;
      }
    }
  }

  // Edge after last chunk
  if (hunkGroups.length > 0) {
    const lastGroup = hunkGroups[hunkGroups.length - 1];
    rowGroups.push({ type: 'edge', gapStart: lastGroup[lastGroup.length - 1].newEnd + 1, gapEnd: null });
  }

  // Annotate each change with how many adjacent ctx rows it has above/below
  for (let i = 0; i < rowGroups.length; i++) {
    if (rowGroups[i].type !== 'change') continue;
    let above = 0;
    for (let j = i - 1; j >= 0 && rowGroups[j].type === 'ctx'; j--) above++;
    let below = 0;
    for (let j = i + 1; j < rowGroups.length && rowGroups[j].type === 'ctx'; j++) below++;
    rowGroups[i].ctxAbove = above;
    rowGroups[i].ctxBelow = below;
  }

  // --- Segment rowGroups into alternating gap / content blocks ---
  // Each content segment gets its own pair of tables (left + right).
  // Gap segments become full-width divs between split blocks.
  const segments = [];
  let pendingRows = [];
  for (const group of rowGroups) {
    if (group.type === 'sep' || group.type === 'edge') {
      segments.push({ type: 'content', rows: pendingRows });
      pendingRows = [];
      segments.push({ type: 'gap', group });
    } else {
      pendingRows.push(group);
    }
  }
  segments.push({ type: 'content', rows: pendingRows });

  // Pre-create tables for each content segment so gap expand callbacks can reference them
  for (const seg of segments) {
    if (seg.type !== 'content') continue;
    seg.leftTable = document.createElement('table');
    seg.leftTable.className = 'commit-diff-table';
    seg.rightTable = document.createElement('table');
    seg.rightTable.className = 'commit-diff-table';
  }

  // --- Intra-line diff helpers ---
  function setIntraCell(td, text, hlCls, start, end) {
    if (!text) return;
    if (start > 0) td.appendChild(document.createTextNode(text.slice(0, start)));
    if (start < end) {
      const span = document.createElement('span');
      span.className = hlCls;
      span.textContent = text.slice(start, end);
      td.appendChild(span);
    }
    if (end < text.length) td.appendChild(document.createTextNode(text.slice(end)));
  }

  function applyIntraLineDiff(tdL, tdR, leftText, rightText) {
    let pre = 0;
    const minLen = Math.min(leftText.length, rightText.length);
    while (pre < minLen && leftText[pre] === rightText[pre]) pre++;
    let suf = 0;
    const maxSuf = Math.min(leftText.length - pre, rightText.length - pre);
    while (suf < maxSuf && leftText[leftText.length - 1 - suf] === rightText[rightText.length - 1 - suf]) suf++;
    setIntraCell(tdL, leftText,  'commit-diff-del-hl', pre, leftText.length  - suf);
    setIntraCell(tdR, rightText, 'commit-diff-add-hl', pre, rightText.length - suf);
  }

  // --- SVG trapezoid connectors ---
  function drawBlockConnectors(svg, changeBlocks) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const svgRect = svg.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;
    svg.setAttribute('width', svgRect.width);
    svg.setAttribute('height', svgRect.height);

    const cs = getComputedStyle(document.documentElement);
    const red    = cs.getPropertyValue('--red').trim()    || '#f87171';
    const green  = cs.getPropertyValue('--green').trim()  || '#4ade80';
    const border = cs.getPropertyValue('--border').trim() || '#404040';

    for (const { leftActive, rightActive, hasDels, hasAdds, polyRef } of changeBlocks) {
      const lTop = leftActive[0].getBoundingClientRect().top - svgRect.top;
      const lBot = leftActive[leftActive.length - 1].getBoundingClientRect().bottom - svgRect.top;
      const rTop = rightActive[0].getBoundingClientRect().top - svgRect.top;
      const rBot = rightActive[rightActive.length - 1].getBoundingClientRect().bottom - svgRect.top;
      const w = svgRect.width;

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', `0,${lTop} ${w},${rTop} ${w},${rBot} 0,${lBot}`);

      const gradId = `conn-grad-${++_gradSeq}`;
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      grad.setAttribute('id', gradId);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '1'); grad.setAttribute('y2', '0');
      const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', hasDels ? red   : border); s1.setAttribute('stop-opacity', hasDels ? '0.10' : '0.15');
      s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', hasAdds ? green : border); s2.setAttribute('stop-opacity', hasAdds ? '0.10' : '0.15');
      grad.appendChild(s1); grad.appendChild(s2);
      defs.appendChild(grad);
      svg.appendChild(defs);
      poly.setAttribute('fill', `url(#${gradId})`);
      poly.setAttribute('class', 'commit-diff-connector-poly');
      svg.appendChild(poly);

      const overlayPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      overlayPoly.setAttribute('points', poly.getAttribute('points'));
      overlayPoly.setAttribute('class', 'commit-diff-connector-overlay');
      svg.appendChild(overlayPoly);

      polyRef.el = overlayPoly;
      if (polyRef.show) {
        overlayPoly.addEventListener('mouseenter', () => { clearTimeout(hideTimer); polyRef.show(); });
        overlayPoly.addEventListener('mouseleave', polyRef.hide);
      }
    }
  }

  // --- Floating action bar (hover overlay per change block) ---
  let floatBar = null;
  let floatRevertBtn = null;
  let hideTimer = null;
  let highlightedRows = [];
  let highlightedPoly = null;

  function clearHighlight() {
    highlightedRows.forEach(tr => tr.classList.remove('commit-diff-hover'));
    highlightedRows = [];
    if (highlightedPoly) { highlightedPoly.classList.remove('commit-diff-connector-overlay--hover'); highlightedPoly = null; }
  }

  if (onRevertLines) {
    floatBar = document.createElement('div');
    floatBar.className = 'commit-diff-float-bar';
    floatBar.style.display = 'none';
    panel.appendChild(floatBar);

    floatRevertBtn = document.createElement('button');
    floatRevertBtn.className = 'commit-diff-float-btn commit-diff-float-revert';
    floatRevertBtn.textContent = '↩ Revert';
    floatBar.appendChild(floatRevertBtn);

    floatBar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    floatBar.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => { floatBar.style.display = 'none'; clearHighlight(); }, 120);
    });
  }

  function attachHover(leftRows, rightRows, group, polyRef) {
    const allRows = [...leftRows, ...rightRows];

    const show = () => {
      clearTimeout(hideTimer);
      clearHighlight();
      highlightedRows = allRows;
      highlightedPoly = polyRef.el;
      allRows.forEach(tr => tr.classList.add('commit-diff-hover'));
      if (polyRef.el) polyRef.el.classList.add('commit-diff-connector-overlay--hover');

      if (floatBar) {
        const panelRect = panel.getBoundingClientRect();
        const rowRect = leftRows[0].getBoundingClientRect();
        floatBar.style.top = (rowRect.top - panelRect.top + panel.scrollTop) + 'px';
        floatBar.style.display = '';
        floatRevertBtn.onclick = () => {
          floatBar.style.display = 'none';
          clearHighlight();
          onRevertLines([group.changeData]);
        };
      }
    };

    const hide = () => {
      hideTimer = setTimeout(() => {
        if (floatBar) floatBar.style.display = 'none';
        clearHighlight();
      }, 120);
    };

    allRows.forEach(tr => {
      tr.addEventListener('mouseenter', show);
      tr.addEventListener('mouseleave', hide);
    });

    polyRef.show = show;
    polyRef.hide = hide;
  }

  // --- Row factories ---
  function makeCtxRow(text) {
    const makeTr = () => {
      const tr = document.createElement('tr');
      tr.className = 'commit-diff-ctx-row';
      const td = document.createElement('td');
      td.className = 'commit-diff-cell';
      td.textContent = text;
      tr.appendChild(td);
      return tr;
    };
    return { leftTr: makeTr(), rightTr: makeTr() };
  }

  // Populates a content segment's tables with its rows
  function populateContentSeg(seg) {
    seg.changeBlocks = [];
    for (const group of seg.rows) {
      if (group.type === 'ctx') {
        const { leftTr, rightTr } = makeCtxRow(group.text);
        seg.leftTable.appendChild(leftTr);
        seg.rightTable.appendChild(rightTr);
      } else {
        const blockLeftRows = [], blockRightRows = [];
        const blockLeftActive = [], blockRightActive = [];
        group.pairs.forEach((pair) => {
          const trL = document.createElement('tr');
          trL.className = 'commit-diff-change-row';
          const trR = document.createElement('tr');
          trR.className = 'commit-diff-change-row';
          const tdL = document.createElement('td');
          const tdR = document.createElement('td');
          tdL.className = 'commit-diff-cell' + (pair.left  !== null ? ' commit-diff-del' : ' commit-diff-pad');
          tdR.className = 'commit-diff-cell' + (pair.right !== null ? ' commit-diff-add' : ' commit-diff-pad');
          applyIntraLineDiff(tdL, tdR, pair.left ?? '', pair.right ?? '');
          trL.appendChild(tdL);
          trR.appendChild(tdR);
          seg.leftTable.appendChild(trL);
          seg.rightTable.appendChild(trR);
          blockLeftRows.push(trL);
          blockRightRows.push(trR);
          if (pair.left  !== null) blockLeftActive.push(trL);
          if (pair.right !== null) blockRightActive.push(trR);
        });
        const polyRef = { el: null };
        attachHover(blockLeftRows, blockRightRows, group, polyRef);
        seg.changeBlocks.push({
          leftActive:  blockLeftActive.length  ? blockLeftActive  : blockLeftRows,
          rightActive: blockRightActive.length ? blockRightActive : blockRightRows,
          hasDels: blockLeftActive.length  > 0,
          hasAdds: blockRightActive.length > 0,
          polyRef,
        });
      }
    }
  }

  // Builds a full-width gap div. prevSeg/nextSeg are the adjacent content segments (may be undefined).
  function makeGapDiv(group, prevSeg, nextSeg) {
    const isSep = group.type === 'sep';
    const canExpand = onExpandGap && (group.gapEnd === null || group.gapEnd >= group.gapStart);

    const div = document.createElement('div');
    div.className = isSep ? 'commit-diff-gap commit-diff-gap--sep' : 'commit-diff-gap commit-diff-gap--edge';

    if (!canExpand) return div;

    let gapStart = group.gapStart;
    let gapEnd = group.gapEnd;

    const rebuild = () => {
      div.innerHTML = '';
      const bar = document.createElement('span');
      bar.className = 'commit-diff-expand-bar';

      const onClick = (fn) => async () => {
        bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
        await fn();
      };

      const makeTextBtn = (text, fn) => {
        const btn = document.createElement('button');
        btn.className = 'commit-diff-expand-btn';
        btn.textContent = text;
        btn.addEventListener('click', onClick(fn));
        return btn;
      };

      const makeArrowBtn = (dir, n, fn) => {
        const btn = document.createElement('button');
        btn.className = 'commit-diff-expand-btn';
        const icon = document.createElement('span');
        icon.className = 'commit-diff-expand-icon';
        icon.innerHTML = dir === 'up'
          ? '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 8 0.5 1.5h8z" fill="currentColor"/></svg>'
          : '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 1 8.5 7.5h-8z" fill="currentColor"/></svg>';
        const num = document.createElement('span');
        num.textContent = n;
        btn.appendChild(icon);
        btn.appendChild(num);
        btn.addEventListener('click', onClick(fn));
        return btn;
      };

      const makeSep = () => {
        const s = document.createElement('span');
        s.className = 'commit-diff-expand-sep';
        return s;
      };

      if (!prevSeg) {
        // First (top-edge) gap: "Show hidden lines" (all) + ↓5 ↓10 ↓15
        bar.appendChild(makeTextBtn('Show hidden lines', async () => {
          const lines = await onExpandGap(gapStart, gapEnd);
          if (lines?.length && nextSeg) {
            const firstLeft = nextSeg.leftTable.firstChild;
            const firstRight = nextSeg.rightTable.firstChild;
            lines.forEach(line => {
              const { leftTr, rightTr } = makeCtxRow(line);
              if (firstLeft) nextSeg.leftTable.insertBefore(leftTr, firstLeft);
              else nextSeg.leftTable.appendChild(leftTr);
              if (firstRight) nextSeg.rightTable.insertBefore(rightTr, firstRight);
              else nextSeg.rightTable.appendChild(rightTr);
            });
          }
          div.remove();
        }));
        if (gapEnd !== null) {
          bar.appendChild(makeSep());
          [5, 10, 15].forEach(n => {
            bar.appendChild(makeArrowBtn('down', n, async () => {
              const start = Math.max(gapEnd - n + 1, gapStart);
              const lines = await onExpandGap(start, gapEnd);
              if (lines?.length && nextSeg) {
                const firstLeft = nextSeg.leftTable.firstChild;
                const firstRight = nextSeg.rightTable.firstChild;
                lines.forEach(line => {
                  const { leftTr, rightTr } = makeCtxRow(line);
                  if (firstLeft) nextSeg.leftTable.insertBefore(leftTr, firstLeft);
                  else nextSeg.leftTable.appendChild(leftTr);
                  if (firstRight) nextSeg.rightTable.insertBefore(rightTr, firstRight);
                  else nextSeg.rightTable.appendChild(rightTr);
                });
                gapEnd -= lines.length;
              }
              if (gapStart > gapEnd) { div.remove(); return; }
              rebuild();
            }));
          });
        }
      } else {
        // ↑ N: load N lines from top of gap → append to prevSeg's tables
        [15, 10, 5].forEach(n => {
          bar.appendChild(makeArrowBtn('up', n, async () => {
            const end = gapEnd !== null ? Math.min(gapStart + n - 1, gapEnd) : gapStart + n - 1;
            const lines = await onExpandGap(gapStart, end);
            if (lines?.length && prevSeg) {
              lines.forEach(line => {
                const { leftTr, rightTr } = makeCtxRow(line);
                prevSeg.leftTable.appendChild(leftTr);
                prevSeg.rightTable.appendChild(rightTr);
              });
              gapStart += lines.length;
            }
            if (gapEnd !== null && gapStart > gapEnd) { div.remove(); return; }
            rebuild();
          }));
        });

        bar.appendChild(makeSep());

        // Show all
        bar.appendChild(makeTextBtn('Show hidden lines', async () => {
          const lines = await onExpandGap(gapStart, gapEnd);
          if (lines?.length && prevSeg) {
            lines.forEach(line => {
              const { leftTr, rightTr } = makeCtxRow(line);
              prevSeg.leftTable.appendChild(leftTr);
              prevSeg.rightTable.appendChild(rightTr);
            });
          }
          div.remove();
        }));

        // ↓ N: load N lines from bottom of gap → prepend to nextSeg's tables
        if (gapEnd !== null) {
          bar.appendChild(makeSep());
          [5, 10, 15].forEach(n => {
            bar.appendChild(makeArrowBtn('down', n, async () => {
              const start = Math.max(gapEnd - n + 1, gapStart);
              const lines = await onExpandGap(start, gapEnd);
              if (lines?.length && nextSeg) {
                const firstLeft = nextSeg.leftTable.firstChild;
                const firstRight = nextSeg.rightTable.firstChild;
                lines.forEach(line => {
                  const { leftTr, rightTr } = makeCtxRow(line);
                  if (firstLeft) nextSeg.leftTable.insertBefore(leftTr, firstLeft);
                  else nextSeg.leftTable.appendChild(leftTr);
                  if (firstRight) nextSeg.rightTable.insertBefore(rightTr, firstRight);
                  else nextSeg.rightTable.appendChild(rightTr);
                });
                gapEnd -= lines.length;
              }
              if (gapStart > gapEnd) { div.remove(); return; }
              rebuild();
            }));
          });
        }
      }

      div.appendChild(bar);
    };

    rebuild();
    return div;
  }

  // --- Build and mount the DOM ---
  const outer = document.createElement('div');
  outer.className = 'commit-diff-outer';

  // Populate all content segment tables first
  for (const seg of segments) {
    if (seg.type === 'content') populateContentSeg(seg);
  }

  // All scroll panes, for sync
  const allPanes = [];
  let syncing = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'gap') {
      const prevSeg = segments[i - 1]?.rows?.length ? segments[i - 1] : undefined;
      const nextSeg = segments[i + 1]?.rows?.length ? segments[i + 1] : undefined;
      outer.appendChild(makeGapDiv(seg.group, prevSeg, nextSeg));
    } else {
      if (seg.rows.length === 0) continue;

      const block = document.createElement('div');
      block.className = 'commit-diff-split-block';

      const leftPane = document.createElement('div');
      leftPane.className = 'commit-diff-pane commit-diff-pane--left';
      leftPane.appendChild(seg.leftTable);

      const rightPane = document.createElement('div');
      rightPane.className = 'commit-diff-pane commit-diff-pane--right';
      rightPane.appendChild(seg.rightTable);

      const connSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      connSvg.setAttribute('class', 'commit-diff-connectors');

      block.appendChild(leftPane);
      block.appendChild(connSvg);
      block.appendChild(rightPane);
      outer.appendChild(block);

      const cb = seg.changeBlocks;
      let rafId;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => drawBlockConnectors(connSvg, cb));
      });
      ro.observe(block);

      allPanes.push(leftPane, rightPane);
    }
  }

  // Sync horizontal scroll across all panes
  allPanes.forEach(pane => {
    pane.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      allPanes.forEach(p => { if (p !== pane) p.scrollLeft = pane.scrollLeft; });
      syncing = false;
    });
  });

  panel.appendChild(outer);
}
