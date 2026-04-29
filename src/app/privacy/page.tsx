import type { Metadata } from "next";
import Link from "next/link";
import {
  PRIVACY_VERSION,
  PRIVACY_EFFECTIVE_DATE,
  LEGAL_CONTACT_EMAIL,
} from "@/lib/legalVersions";

export const metadata: Metadata = {
  title: "Política de Privacidad | maTickets",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Política de Privacidad</h1>
        <p className="text-muted text-sm mb-8">
          Versión {PRIVACY_VERSION} · Vigente desde el {PRIVACY_EFFECTIVE_DATE}
        </p>

        <div className="space-y-6 text-foreground/80 leading-relaxed">
          <section>
            <p>
              La presente Política de Privacidad describe cómo <strong>maTickets</strong>
              (en adelante, &quot;la Plataforma&quot;) recolecta, utiliza, almacena,
              protege y comparte los datos personales de sus usuarios. Se emite en
              cumplimiento del derecho constitucional de habeas data previsto en
              el artículo 28 de la Constitución de la República Bolivariana de
              Venezuela y de la normativa aplicable en materia de protección al
              consumidor y delitos informáticos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">1. Responsable del tratamiento</h2>
            <p>
              El responsable del tratamiento de los datos personales es maTickets.
              Para cualquier solicitud relacionada con el ejercicio de sus derechos
              sobre datos personales, contacte al correo{" "}
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-accent-light hover:text-accent underline"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">2. Datos que recolectamos</h2>
            <p><strong>De los compradores:</strong></p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>Nombre y apellido.</li>
              <li>Cédula de identidad.</li>
              <li>Correo electrónico.</li>
              <li>Comprobante de pago (captura o archivo) y número de referencia.</li>
              <li>
                Campos adicionales que el Organizador pueda solicitar para su
                evento (ej. talla, acompañante, identificación de menor).
              </li>
            </ul>
            <p className="mt-3"><strong>De los organizadores:</strong></p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>Correo electrónico y clave (almacenada con hash criptográfico).</li>
              <li>
                Datos asociados a los métodos de pago configurados para sus
                eventos: correo y nombre de Zelle, cédula, teléfono y banco
                asociados a Pago Móvil, y otras referencias operativas.
              </li>
              <li>Información de los eventos publicados, precios y configuraciones.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">3. Finalidad del tratamiento</h2>
            <p>Los datos se tratan para las siguientes finalidades:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Gestionar la compra, aprobación y entrega de la entrada electrónica.</li>
              <li>Enviar confirmaciones, tickets y comunicaciones relativas al evento por correo electrónico.</li>
              <li>Permitir al Organizador verificar, aprobar y contactar al Comprador.</li>
              <li>Validar la identidad del asistente al momento del acceso al evento (QR + cédula).</li>
              <li>Calcular, cobrar y conciliar las comisiones adeudadas por los Organizadores por el uso de la Plataforma.</li>
              <li>Prevenir y detectar fraude, usos indebidos y duplicación de comprobantes.</li>
              <li>Dar cumplimiento a requerimientos legales o de autoridad competente.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">4. Con quién compartimos los datos</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Organizador del evento:</strong> recibe los datos de los
                compradores de sus entradas para aprobar la venta, gestionar
                acceso, atención al cliente y cumplir sus propias obligaciones
                fiscales y comerciales. El Organizador actúa como corresponsable
                del tratamiento.
              </li>
              <li>
                <strong>Proveedores tecnológicos:</strong> InstantDB (base de datos
                y almacenamiento), proveedores de correo transaccional (Resend,
                Amazon SES o Gmail) y proveedores de hospedaje. Estos actúan como
                encargados del tratamiento y están obligados a aplicar medidas
                razonables de seguridad.
              </li>
              <li>
                <strong>Autoridades competentes:</strong> cuando medie requerimiento
                fundado de autoridad judicial o administrativa venezolana.
              </li>
            </ul>
            <p className="mt-2">
              <strong>maTickets no vende, alquila ni comercializa los datos
              personales con terceros con fines publicitarios.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">5. Conservación de los datos</h2>
            <p>
              Los datos se conservan por el tiempo necesario para cumplir las
              finalidades descritas y los plazos de eventuales obligaciones
              fiscales, contables o legales. Los comprobantes de pago cargados por
              los compradores se almacenan en la ruta técnica{" "}
              <code className="text-xs bg-surface px-1.5 py-0.5 rounded">payment-proofs/</code>
              y están disponibles únicamente para el Organizador correspondiente y
              para el super-administrador de la Plataforma.
            </p>
            <p className="mt-2">
              El titular puede solicitar la eliminación de sus datos personales en
              cualquier momento, salvo que exista obligación legal de conservarlos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. Derechos del titular</h2>
            <p>
              De conformidad con el artículo 28 de la Constitución, el titular
              tiene derecho a:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><strong>Acceder</strong> a sus datos personales tratados por la Plataforma.</li>
              <li><strong>Rectificar</strong> la información inexacta o incompleta.</li>
              <li><strong>Solicitar la eliminación</strong> de los datos que ya no sean necesarios.</li>
              <li><strong>Oponerse</strong> a tratamientos que considere improcedentes.</li>
              <li><strong>Revocar</strong> el consentimiento prestado, cuando el tratamiento se base en él.</li>
            </ul>
            <p className="mt-2">
              Para ejercer estos derechos, envíe su solicitud a{" "}
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-accent-light hover:text-accent underline"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>{" "}
              indicando su identificación y el derecho que ejerce. La respuesta se
              emitirá en un plazo razonable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">7. Seguridad de la información</h2>
            <p>
              Implementamos medidas técnicas y organizativas razonables: conexiones
              cifradas (HTTPS), hash de contraseñas, control de accesos por
              autenticación, permisos a nivel de campo y auditoría de cambios.
              Ninguna medida es infalible; el usuario se compromete a mantener sus
              credenciales en secreto y a notificar cualquier acceso no autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Menores de edad</h2>
            <p>
              La Plataforma está destinada a mayores de 18 años. Los menores solo
              pueden adquirir entradas con la intervención y bajo la
              responsabilidad de sus padres o representantes legales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">9. Cookies y tecnologías similares</h2>
            <p>
              La Plataforma utiliza cookies técnicas y de sesión estrictamente
              necesarias para el funcionamiento del servicio (autenticación, cola
              de compra, preferencias de idioma). No empleamos cookies de
              seguimiento publicitario de terceros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">10. Modificaciones</h2>
            <p>
              Esta Política podrá ser actualizada. Los cambios se publicarán en
              esta página con una nueva fecha de vigencia. Cuando los cambios sean
              sustanciales, se notificarán con al menos quince (15) días de
              antelación a los usuarios registrados y, para los compradores, al
              momento de su próxima compra.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">11. Ley aplicable</h2>
            <p>
              Esta Política se rige por las leyes de la República Bolivariana de
              Venezuela. Para controversias, son competentes los tribunales de la
              ciudad de Caracas.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-wrap gap-4">
          <Link href="/" className="text-accent-light hover:text-accent transition-colors">
            Volver al inicio
          </Link>
          <Link href="/terms" className="text-accent-light hover:text-accent transition-colors">
            Términos y Condiciones
          </Link>
          <Link
            href="/terminos-organizador"
            className="text-accent-light hover:text-accent transition-colors"
          >
            Términos del Organizador
          </Link>
        </div>
      </main>
    </div>
  );
}
