/* compat.mjs — parche de compatibilidad para pdf.js 6.1.200.
   pdf.js usa Map.prototype.getOrInsert / getOrInsertComputed (propuesta TC39
   "Map.getOrInsert"), que todavia no esta disponible en muchos navegadores de
   2026. Sin este shim la biblioteca revienta al renderizar con
   "getOrInsertComputed is not a function". Se importa antes que pdf.min.mjs y
   antes que el worker (worker-boot.mjs), porque el worker es otro contexto JS.
   No modifica los archivos vendorizados. */
(function () {
  "use strict";
  function def(proto, name, fn) {
    if (proto && typeof proto[name] !== "function") {
      Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
    }
  }
  [Map.prototype, WeakMap.prototype].forEach(function (p) {
    def(p, "getOrInsert", function (key, value) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    });
    def(p, "getOrInsertComputed", function (key, callback) {
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key);
    });
  });
})();
