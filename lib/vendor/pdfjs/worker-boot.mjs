/* worker-boot.mjs — punto de entrada del worker de pdf.js.
   Instala el shim de compatibilidad y despues carga el worker vendorizado
   sin tocarlo. */
import "./compat.mjs";
import "./pdf.worker.min.mjs";
