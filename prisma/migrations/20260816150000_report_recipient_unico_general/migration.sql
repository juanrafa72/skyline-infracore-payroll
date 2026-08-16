-- Un mismo correo, dos veces, recibiendo TODO.
--
-- La llave única de la tabla incluye la empresa receptora, y en Postgres dos
-- nulos no se consideran iguales: el destinatario general —el de contabilidad,
-- que no está atado a ninguna empresa— podía entrar repetido y a Ana le
-- llegaría cada reporte por duplicado. La aplicación ya lo revisa antes de
-- insertar; esto lo asegura también cuando el dato entra por otro lado (una
-- semilla, una importación, una consulta a mano).
CREATE UNIQUE INDEX IF NOT EXISTS "report_recipient_general_unico"
  ON "report_recipient" ("companyId", "email")
  WHERE "paymentRecipientId" IS NULL;
