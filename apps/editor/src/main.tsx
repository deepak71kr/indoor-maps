/** Composition root: restore the last session, wire auto-save, render. */
import { render } from 'preact';
import { autosaver, loadAutosave } from './infra/autosave';
import { newProject } from './model/project';
import { createEditorStore } from './model/store';
import { App } from './ui/App';
import { StoreContext } from './ui/use-editor';
import './styles.css';

const store = createEditorStore(loadAutosave() ?? newProject());
const save = autosaver();
store.subscribe(() => save(store.getState().doc));

const root = document.getElementById('app');
if (root) {
  render(
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>,
    root,
  );
}
