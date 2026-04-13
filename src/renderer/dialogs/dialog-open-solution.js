import { createCombobox } from './combobox.js';
import { toast } from '../toast.js';

const overlay = document.getElementById('open-solution-dialog-overlay');
const searchInput = document.getElementById('open-solution-search');
const listEl = document.getElementById('open-solution-list');
const confirmBtn = document.getElementById('open-solution-confirm-btn');

let _selectedSln = null;

function getRelativePath(wtPath, slnPath) {
  const normalizedWt = wtPath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedSln = slnPath.replace(/\\/g, '/');
  if (normalizedSln.startsWith(normalizedWt + '/')) {
    return normalizedSln.slice(normalizedWt.length + 1);
  }
  return normalizedSln;
}

const solutionCombobox = createCombobox({
  inputEl: searchInput,
  listEl,
  arrowSelector: '#open-solution-combobox .combobox-arrow',
  onHide: () => hideOpenSolutionDialog(),
  getLabel: (item) => item.label,
  isSelected: (item) => _selectedSln && item.slnPath === _selectedSln.slnPath,
  onSelect: (item) => {
    _selectedSln = item;
    searchInput.value = item.label;
    confirmBtn.disabled = false;
    solutionCombobox.close();
  },
  onEnterMatch: (item) => {
    _selectedSln = item;
    searchInput.value = item.label;
    confirmBtn.disabled = false;
    solutionCombobox.close();
    confirmOpenSolution();
  },
  openOnFocus: true,
});

export async function openSolution(wtPath) {
  let solutions;
  try {
    solutions = await window.shellAPI.findSolutions(wtPath);
  } catch {
    toast.error('Failed to search for solution files');
    return;
  }

  if (solutions.length === 0) {
    toast.error('No solution (.sln / .slnf) files found');
    return;
  }

  if (solutions.length === 1) {
    window.shellAPI.openSolution(solutions[0]);
    return;
  }

  const items = solutions.map(slnPath => ({
    slnPath,
    label: getRelativePath(wtPath, slnPath),
  }));

  _selectedSln = null;
  searchInput.value = '';
  confirmBtn.disabled = true;

  solutionCombobox.setItems(items);
  solutionCombobox.render('');

  overlay.classList.add('visible');
  requestAnimationFrame(() => searchInput.focus());
}

function hideOpenSolutionDialog() {
  overlay.classList.remove('visible');
  solutionCombobox.close();
  _selectedSln = null;
}

function confirmOpenSolution() {
  if (!_selectedSln) return;
  window.shellAPI.openSolution(_selectedSln.slnPath);
  hideOpenSolutionDialog();
}

document.getElementById('open-solution-cancel-btn').addEventListener('click', hideOpenSolutionDialog);
confirmBtn.addEventListener('click', confirmOpenSolution);
overlay.addEventListener('mousedown', (e) => {
  if (e.target === overlay) hideOpenSolutionDialog();
});
