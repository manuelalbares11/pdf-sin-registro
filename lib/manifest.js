(function () {
  "use strict";

  // Datos de marca y contenido compartido. Editar aquí, no en el HTML.
  window.__BRAND__ = {
    name: "PDF sin Registro",
    tagline: "Une, comprime, reorganiza y firma PDF en tu propio navegador.",
    dominio: "https://pdfsinregistro.com",
    email: "hola@pdfsinregistro.com",

    limites: {
      tamanoMB: 100,
      paginas: 500
    },

    // Etiquetas de los modos de la herramienta (deep-link ?modo=)
    modos: [
      { id: "organizar", label: "Organizar paginas" },
      { id: "unir",      label: "Unir PDF" },
      { id: "comprimir", label: "Comprimir PDF" },
      { id: "firmar",    label: "Firmar y anotar" }
    ]
  };
})();
