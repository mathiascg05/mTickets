import type { Metadata } from "next";
import Link from "next/link";
import {
  TERMS_VERSION,
  TERMS_EFFECTIVE_DATE,
  LEGAL_CONTACT_EMAIL,
} from "@/lib/legalVersions";

export const metadata: Metadata = {
  title: "Términos y Condiciones | maTickets",
};

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold mb-2">Términos y Condiciones para Compradores</h1>
        <p className="text-muted text-sm mb-8">
          Versión {TERMS_VERSION} · Vigente desde el {TERMS_EFFECTIVE_DATE}
        </p>

        <div className="space-y-6 text-foreground/80 leading-relaxed">
          <section>
            <p>
              Los presentes Términos y Condiciones rigen el uso de la plataforma
              <strong> maTickets</strong> (en adelante, &quot;la Plataforma&quot;) por parte de los
              usuarios compradores de entradas. Al utilizar la Plataforma, adquirir
              una entrada o marcar la casilla de aceptación durante el proceso de
              compra, el usuario declara haber leído, comprendido y aceptado
              íntegramente estos términos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">1. Definiciones</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>maTickets:</strong> plataforma tecnológica que facilita la venta
                y gestión de entradas electrónicas para eventos, actuando
                exclusivamente como <em>intermediario tecnológico</em>. maTickets no es
                el vendedor ni el organizador del evento.
              </li>
              <li>
                <strong>Organizador:</strong> persona natural o jurídica responsable de
                la producción, promoción y realización del evento y emisor final de
                la entrada al comprador.
              </li>
              <li>
                <strong>Comprador:</strong> persona natural que adquiere una o varias
                entradas a través de la Plataforma.
              </li>
              <li>
                <strong>Entrada:</strong> ticket electrónico que acredita el derecho
                de acceso al evento contratado.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">2. Naturaleza del servicio</h2>
            <p>
              maTickets provee la infraestructura tecnológica para que el Organizador
              ofrezca sus entradas y para que el Comprador pueda adquirirlas. <strong>El
              contrato de venta de la entrada se perfecciona entre el Comprador y el
              Organizador</strong>; maTickets no es parte de esa relación comercial y no
              percibe el dinero del Comprador. Los pagos se realizan directamente al
              Organizador a través de los métodos que este habilite (Zelle, Pago
              Móvil, efectivo u otros).
            </p>
            <p className="mt-2">
              maTickets <strong>no emite facturas ni comprobantes fiscales</strong>{" "}
              por las entradas. La emisión de la documentación fiscal que
              corresponda al Comprador, cuando aplique, es responsabilidad
              exclusiva del Organizador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">3. Proceso de compra</h2>
            <ol className="list-decimal list-inside space-y-1">
              <li>El Comprador selecciona el evento y la cantidad de entradas.</li>
              <li>Se le asigna una reserva temporal de hasta quince (15) minutos para completar la compra.</li>
              <li>
                El Comprador paga directamente al Organizador mediante el método
                habilitado y carga el comprobante o número de referencia que
                corresponda.
              </li>
              <li>
                El Organizador revisa y aprueba, rechaza o cancela la orden según
                sus propios criterios. La aceptación de la compra no es automática.
              </li>
              <li>
                Aprobada la orden, el Comprador recibe la entrada electrónica al
                correo registrado.
              </li>
            </ol>
            <p className="mt-2">
              El envío de la solicitud no garantiza la adjudicación de la entrada
              hasta la aprobación del Organizador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">4. Entradas electrónicas y acceso al evento</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Cada entrada es válida para una sola admisión al evento indicado.</li>
              <li>
                El acceso se realiza mediante código QR. El Comprador es responsable
                de la custodia del correo y del código recibido; su divulgación o
                duplicación puede resultar en el uso indebido por terceros, sin
                responsabilidad para maTickets ni para el Organizador.
              </li>
              <li>
                Las entradas son <strong>nominativas y no transferibles</strong>, salvo
                autorización expresa del Organizador. El nombre y cédula indicados
                en el registro deben coincidir con los del asistente.
              </li>
              <li>
                Las entradas duplicadas, adulteradas o adquiridas de forma
                fraudulenta serán anuladas sin derecho a reembolso.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">5. Cancelaciones, cambios y reembolsos</h2>
            <p>
              Las políticas de cancelación, reprogramación y reembolso son
              establecidas y ejecutadas por el <strong>Organizador</strong> de cada
              evento. maTickets no gestiona reembolsos ni determina las condiciones
              aplicables. En caso de:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>
                <strong>Cancelación o reprogramación del evento:</strong> el
                Comprador deberá contactar directamente al Organizador para
                conocer la política vigente.
              </li>
              <li>
                <strong>Orden rechazada por el Organizador:</strong> cualquier monto
                efectivamente pagado al Organizador debe ser reintegrado por este
                por el mismo canal de pago.
              </li>
              <li>
                <strong>No asistencia del Comprador (no-show):</strong> no procede
                reembolso, salvo política expresa en contrario del Organizador.
              </li>
            </ul>
            <p className="mt-2">
              Lo anterior sin perjuicio de los derechos del Comprador previstos en
              la legislación venezolana de protección al consumidor y usuario.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. Conducta del usuario y usos prohibidos</h2>
            <p>El Comprador se obliga a:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Proveer información veraz, completa y actualizada (nombre, cédula, correo).</li>
              <li>
                No utilizar la Plataforma para actividades fraudulentas, reventa no
                autorizada, lavado de activos, suplantación de identidad o
                cualquier conducta tipificada en la <strong>Ley Especial contra los
                Delitos Informáticos</strong> venezolana.
              </li>
              <li>
                No cargar comprobantes de pago falsos, adulterados o pertenecientes
                a terceros.
              </li>
              <li>
                No intentar vulnerar los sistemas, realizar ingeniería inversa o
                acceder a datos ajenos.
              </li>
            </ul>
            <p className="mt-2">
              El incumplimiento de estas obligaciones podrá derivar en la
              cancelación de órdenes, bloqueo del acceso a la Plataforma y las
              acciones legales que correspondan.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">7. Tratamiento de datos personales</h2>
            <p>
              Los datos personales del Comprador son tratados conforme a nuestra{" "}
              <Link href="/privacy" className="text-accent-light hover:text-accent underline">
                Política de Privacidad
              </Link>
              , la cual forma parte integrante de estos Términos. Al aceptar estos
              Términos, el Comprador acepta también dicha Política.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Limitación de responsabilidad</h2>
            <p>
              maTickets provee únicamente la infraestructura tecnológica y no es
              responsable por:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>La realización, calidad, contenido, suspensión o cancelación del evento.</li>
              <li>La veracidad de la información publicada por el Organizador.</li>
              <li>El incumplimiento de las obligaciones del Organizador frente al Comprador.</li>
              <li>Caídas puntuales de servicio ocasionadas por proveedores de terceros o causas de fuerza mayor.</li>
            </ul>
            <p className="mt-2">
              La responsabilidad máxima de maTickets frente al Comprador, de
              verificarse alguna, queda limitada al valor efectivamente atribuible
              al servicio tecnológico prestado para la transacción correspondiente.
            </p>
            <p className="mt-2">
              El servicio se provee <strong>&quot;tal cual&quot; (as-is)</strong>.
              En ningún caso la responsabilidad total acumulada de maTickets
              frente al Comprador excederá el monto efectivamente atribuible al
              servicio tecnológico de la transacción específica reclamada, con
              un tope global de cincuenta dólares de los Estados Unidos de
              América (USD 50) o su equivalente en bolívares.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">9. Mayoría de edad</h2>
            <p>
              El uso de la Plataforma está permitido a personas mayores de 18 años
              o a menores debidamente representados por sus padres o representantes
              legales, quienes asumen la responsabilidad por el uso.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">10. Modificaciones</h2>
            <p>
              maTickets podrá modificar los presentes Términos en cualquier
              momento. Los cambios se publicarán en esta página con una nueva
              fecha de vigencia y, cuando corresponda, se notificarán al Comprador
              por correo electrónico con al menos quince (15) días de antelación.
              El uso continuado de la Plataforma tras la entrada en vigencia
              implica la aceptación de la versión modificada.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">11. Ley aplicable y jurisdicción</h2>
            <p>
              Estos Términos se rigen por las leyes de la{" "}
              <strong>República Bolivariana de Venezuela</strong>. Para cualquier
              controversia derivada o relacionada con los mismos, las partes se
              someten a la competencia de los tribunales de la ciudad de Caracas,
              con expresa renuncia a cualquier otro fuero que pudiera
              corresponderles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">12. Contacto</h2>
            <p>
              Dudas, reclamos o solicitudes relacionadas con estos Términos:{" "}
              <a
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
                className="text-accent-light hover:text-accent underline"
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-wrap gap-4">
          <Link href="/" className="text-accent-light hover:text-accent transition-colors">
            Volver al inicio
          </Link>
          <Link href="/privacy" className="text-accent-light hover:text-accent transition-colors">
            Política de Privacidad
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
