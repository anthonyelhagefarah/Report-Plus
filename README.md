# Report Plus (prototipo)

App web instalable (PWA) para reportes de inspección por cliente con fotos, videos, anotaciones con medidas y exportación a PDF.

## Funciones
- Clientes con datos de contacto y varios reportes por cliente.
- Reportes con secciones (plantillas: Vivienda, Obra, Daños/seguro, Mantenimiento) y párrafo de texto por sección.
- Captura: cámara integrada en ráfaga (fotos sin confirmar cada una) y grabación de video; también cámara/video del sistema e importación desde galería.
- Anotaciones sobre fotos: flecha, cota de medida con valor, círculo, rectángulo, texto y trazo libre; colores, grosor, deshacer. Se pueden volver a editar.
- Descripción y medida por foto o video, reordenar, mover de sección, elegir foto de portada.
- PDF: portada con logo y datos de la empresa, observaciones, diseño vertical u horizontal (1×1 a 3×4), encabezado y número de página. Los videos aparecen con miniatura, duración y nombre de archivo.
- ZIP: el PDF + carpeta videos/ + carpeta fotos/, listo para enviar.
- Compartir reporte editable (.rplus), duplicar reporte, respaldo y restauración completa.
- Funciona sin internet una vez instalada. Todo se guarda en el teléfono.

## Probar en computadora
Desde esta carpeta: `npx http-server -p 8080` y abrir http://localhost:8080

## Instalar en el teléfono
Debe publicarse con HTTPS (por ejemplo GitHub Pages). Luego abrir el enlace en el teléfono:
- Android (Chrome): menú ⋮ → "Instalar app".
- iPhone (Safari): botón Compartir → "Agregar a pantalla de inicio".
