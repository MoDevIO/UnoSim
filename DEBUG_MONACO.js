/**
 * Monaco Editor Debug Script
 * 
 * Führen Sie dies in der Browser-Konsole aus (F12), um den Editor-Zustand zu diagnostizieren:
 * copy(await fetch('DEBUG_MONACO.js').then(r => r.text())) && eval(await fetch('DEBUG_MONACO.js').then(r => r.text()))
 * 
 * ODER manuell in der Konsole:
 */

console.log('=== 🔍 MONACO EDITOR DIAGNOSTICS ===');

// 1. Container finden
const container = document.querySelector('[data-testid="code-editor"]');
console.log('1. Container gefunden:', !!container);
if (container) {
  console.log('   - offsetHeight:', container.offsetHeight);
  console.log('   - offsetWidth:', container.offsetWidth);
  console.log('   - innerHTML length:', container.innerHTML?.length);
  
  const computed = window.getComputedStyle(container);
  console.log('   - Computed CSS:', {
    display: computed.display,
    visibility: computed.visibility,
    opacity: computed.opacity,
    height: computed.height,
    width: computed.width,
    position: computed.position,
  });
}

// 2. Monaco Editor Instanz finden
const monacoEditors = (window.monaco?.editor?.getEditors?.() || []);
console.log('2. Monaco Editoren gefunden:', monacoEditors.length);
monacoEditors.forEach((editor, i) => {
  console.log(`   Editor ${i}:`, {
    isDiffEditor: editor.isDiffEditor?.(),
    hasModel: !!editor.getModel?.(),
    contentHeight: editor.getContentHeight?.(),
    lineCount: editor.getModel?.()?.getLineCount?.(),
  });
  
  const dom = editor.getDomNode?.();
  if (dom) {
    console.log(`   DOM ${i}:`, {
      offsetHeight: dom.offsetHeight,
      offsetWidth: dom.offsetWidth,
      display: window.getComputedStyle(dom).display,
    });
  }
});

// 3. Manuelle Layout-Auslösung
console.log('3. Triggering editor.layout()...');
monacoEditors.forEach((editor, i) => {
  try {
    editor.layout?.();
    console.log(`   ✓ Editor ${i} layout triggered`);
  } catch (e) {
    console.log(`   ✗ Editor ${i} layout failed:`, e.message);
  }
});

// 4. Eltern-Container überprüfen
console.log('4. Parent containers:');
let parent = container?.parentElement;
let level = 0;
while (parent && level < 5) {
  const computed = window.getComputedStyle(parent);
  console.log(`   Level ${level} (${parent.className}):`, {
    display: computed.display,
    height: computed.height,
    overflow: computed.overflow,
  });
  parent = parent.parentElement;
  level++;
}

console.log('=== END DIAGNOSTICS ===');
