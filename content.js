(() => {
  const REQUIRED_CLASS = "skin-sidebar-plugin";
  const ALLOWED_CLASSES = new Set([REQUIRED_CLASS, "show"]);
  const detachedMenus = new Map();
  let removeMenu = false;

  function isTargetElement(node) {
    if (!(node instanceof Element) || !node.classList.contains(REQUIRED_CLASS)) return false;
    return Array.from(node.classList).every((name) => ALLOWED_CLASSES.has(name));
  }

  function removeIfTarget(node) {
    if (!removeMenu || !node.isConnected || !isTargetElement(node)) return;
    // Preserve the original element and its listeners for the off switch.
    const marker = document.createComment("paramount-menu-remover");
    node.before(marker);
    detachedMenus.set(marker, node);
    node.remove();
  }

  function removeTargetElements(root = document) {
    if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
    root.querySelectorAll(".skin-sidebar-plugin").forEach(removeIfTarget);
  }

  const observer = new MutationObserver((mutations) => {
    for (const [marker] of detachedMenus) {
      if (!marker.isConnected) detachedMenus.delete(marker);
    }
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        removeIfTarget(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element || node instanceof DocumentFragment)) continue;
        removeIfTarget(node);
        removeTargetElements(node);
      }
    }
  });

  function applyMenuPreference(enabled) {
    removeMenu = enabled !== false;
    observer.disconnect();
    if (!removeMenu) {
      for (const [marker, node] of detachedMenus) {
        if (marker.isConnected) marker.replaceWith(node);
      }
      detachedMenus.clear();
      return;
    }
    removeTargetElements();
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true
    });
  }

  chrome.storage.local.get({ removeMenu: true }, (settings) => {
    if (document.documentElement) applyMenuPreference(settings.removeMenu);
    else document.addEventListener("DOMContentLoaded", () => applyMenuPreference(settings.removeMenu), { once: true });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.removeMenu) applyMenuPreference(changes.removeMenu.newValue);
  });
})();
