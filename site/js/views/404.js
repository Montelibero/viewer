export async function init(params, i18n) {
    // No special logic needed, i18n is applied by default in initI18n -> apply()
    // but initI18n is called in router, which passes the instance here.
    // The router's initI18n calls apply() internally.
    // However, the text replacement happens on elements available in DOM.
    // Since loadView sets innerHTML BEFORE calling init, the elements are there.
    // AND initI18n call in router happens AFTER innerHTML is set?
    
    // Let's check router.js again.
    /*
        app.innerHTML = html;
        const module = await import(`./views/${viewName}.js?v=7`);
        if (module && typeof module.init === 'function') {
            currentView = module;
            const i18n = await initI18n({ baseName: viewName }); // This calls apply() inside!
            await module.init(params, i18n);
        }
    */
    // Yes, initI18n is called after app.innerHTML is set. So apply() inside initI18n will work.
}
