# Audit handover: seven waves, what they changed, and what is left

This file closes the audit cadence. It exists so the work is reviewable in one place instead of across forty commits and a running log, and so the next person knows which parts are guarded and which are not.

## What the waves changed

- **Prompt conformance.** Eight fixes, ending with the session-state bookkeeping messages carrying no model-facing text at all.
- **Dead code, three kinds.** A 156-line tab component nothing imported was deleted by hand, which turned into the module-reachability gate. Dead exports and duplicated function bodies got gates of the same shape.
- **The tab row.** A scrolling rail with inline drag, stow and reorder, shared by the settings workspace and the extension-preset manager, with a touch hold, arrow-key focus, and both rows reading one stored layout.
- **Theme tokens.** Four surfaces asked for tokens the host does not define and fell back to light-theme values, which painted a white plate under the selected tab in the dark theme. All four now name tokens the host defines, and a case fails on any unknown one.
- **Two defects only a browser showed.** A session with no extension scope was polled every 2.5 seconds for 336 reads and 336 console errors; it now backs off to a 30 second cap. And the control reported "could not load" for what was really "not ready yet".
- **Package integrity.** The tarball was verified as an installed package for the first time: 189 modules, 531 relative specifiers, none missing.

## What is guarded, and by what

`check:refactor` runs eleven checks plus two guards in the test suite. [The gate map](../../reference/gate-map.md) is the inventory; [its second half](../../reference/gate-map.md) lists what no gate sees.

Each gate was proved to reject a deliberate violation before it landed. One still shipped with a hole: the package-contents gate ignored side-effect imports until a probe it should have caught went through.

## What is left, and who decides

Three items need a product decision, not engineering:

1. **Editor weight.** Shipped client bundle 1,831,600 bytes. Dropping the Markdown grammar: 1,550,862 (−15.3%). Replacing all editors with textareas: 869,357 (−52.5%), which loses highlighting, line numbers, bracket matching, the undo keymap and tab indent.
2. **The resource-window surface.** Three components and their copy are unreachable: the client entry mounts no slot for them. Deleting them typechecks with nothing else touched and moves the bundle by 0.2%, so the decision is whether the feature returns, not what it saves.
3. **The stowed-tab menu wording.** Clicking a stowed tab selects it, and the selected tab always renders, so it reads as "show". Three options are recorded in the backlog.

One deferred cleanup needs a browser: ten CSS classes no importer names are recorded in [the CSS ledger](../../reference/css-classes.md), and five of them appear nowhere in the repository at all.

## How to reopen

Start a wave by asking what the gates cannot see. The shortest path is the second half of the gate map, which lists the four blind spots this cadence actually hit: behaviour in a browser, unreferenced CSS, upgrade paths, and a gate's own blind spot.
