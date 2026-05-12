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
              usuarios compradores de entradas. Al utilizar la Plataforma, comprar
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
                exclusivamente como <em>intermediario tecnológico</em>. maTickets es el
                comercializador de los boletos o entradas; la plataforma es solo un
                espacio para la promoción y publicidad del evento. maTickets no es el
                organizador ni el productor del evento.
              </li>
              <li>
                <strong>Organizador:</strong> persona natural o jurídica única
                responsable de la producción, promoción, y realización del evento y
                emisor final de la entrada al comprador.
              </li>
              <li>
                <strong>Comprador:</strong> persona natural que compra una o varias
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
              <strong>
                maTickets solo ofrecerá las entradas que el Organizador le
                proporcione y están limitadas a su disposición y asignación por
                parte de este último. maTickets no tiene ninguna injerencia de
                la emisión y asignación de las mismas.
              </strong>
            </p>
            <p className="mt-2">
              maTickets provee la infraestructura tecnológica para que el Organizador
              ofrezca sus entradas y para que el Comprador pueda comprarlas. <strong>El
              contrato de venta de la entrada se perfecciona entre el Comprador y el
              Organizador</strong>; maTickets no es parte de esa relación comercial y no
              percibe el dinero del Comprador. Los pagos se realizan directamente al
              Organizador a través de los métodos que este último habilite, por
              cualquiera de los siguientes: Zelle, Pago Móvil, efectivo u otros.
            </p>
            <p className="mt-2">
              maTickets solo se limita a la publicidad y comercialización de la
              entrada, por tales motivos <strong>no emite ni facturas ni
              comprobantes fiscales</strong>. El Organizador será el único
              responsable de la emisión de dichos documentos fiscales y el
              Comprador está en la obligación de solicitarlo formal y
              directamente al Organizador.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">3. Proceso de compra</h2>
            <ol className="list-decimal list-inside space-y-1">
              <li>El Comprador selecciona el evento y la cantidad de entradas.</li>
              <li>El Comprador tendrá un tiempo perentorio de quince (15) minutos para completar la compra.</li>
              <li>
                El Comprador paga directamente al Organizador mediante el método
                habilitado en la Plataforma, debiendo colocar el número de
                referencia y cualquier otro dato solicitado a los fines de su
                verificación.
              </li>
              <li>
                El Organizador revisa y aprueba, rechaza o cancela la orden según
                sus propios criterios. La aceptación de la compra no es automática.
              </li>
              <li>
                Aprobada la orden, el Comprador recibe la entrada electrónica al
                correo registrado.
              </li>
              <li>
                Recibida la entrada por correo electrónico, el Comprador está en
                la obligación de verificar todos los datos de la entrada,
                especialmente si corresponden al evento seleccionado, la fecha
                del mismo, el nombre y apellido del usuario y su identificación.
                El Comprador será el único responsable de la verificación de los
                mismos y deberá formular el reclamo por escrito hasta
                veinticuatro (24) horas antes del inicio del evento.
              </li>
            </ol>
            <p className="mt-2">
              El envío de la solicitud no garantiza la adjudicación de la entrada
              hasta la aprobación del Organizador, quien es el único responsable
              de la emisión de la entrada.
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
                Las entradas son <strong>nominativas, personales y no transferibles</strong>, salvo
                autorización expresa del Organizador. El nombre y cédula indicados
                en el registro deben coincidir con los del asistente.
              </li>
              <li>
                Las entradas duplicadas, adulteradas o obtenidas de forma
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
            <p className="mt-2">
              maTickets, por ser una plataforma para la publicidad y
              comercialización de entradas de un tercero, no es responsable de
              dichos reembolsos o devoluciones. El Comprador se obliga a realizar
              las solicitudes o reclamos directamente con el Organizador del
              evento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. Conducta del usuario y usos prohibidos</h2>
            <p>
              El Comprador reconoce, se obliga y acepta que el acceso a la
              Plataforma se concede únicamente para la adquisición final y
              personal de entradas. En consecuencia, queda terminantemente
              prohibido:
            </p>
            <ul className="list-none space-y-2 mt-2">
              <li>
                <strong>a)</strong> La reventa de las entradas, entendiéndose
                por esto la reventa de boletos con fines de lucro, especulación
                o &ldquo;bachaqueo&rdquo; digital, actividad sancionada bajo el
                ordenamiento jurídico venezolano vigente.
              </li>
              <li>
                <strong>b)</strong> El fraude o delitos informáticos, el uso
                de identidades falsas, tarjetas de crédito/débito sin
                autorización de su titular, o cualquier maniobra tecnológica
                destinada a vulnerar la seguridad del sitio. maTickets o el
                Organizador no serán responsables de dichas actividades y, en
                caso de que se percaten de dichas conductas, serán reportadas
                de inmediato a las autoridades competentes, todo ello conforme
                a la <strong>Ley Especial contra los Delitos Informáticos</strong>.
              </li>
              <li>
                <strong>c)</strong> El uso de la Plataforma para legitimación
                de capitales, financiamiento al terrorismo o cualquier otra
                actividad contraria a la ley, la moral o las buenas costumbres.
              </li>
            </ul>
            <p className="mt-2">
              El incumplimiento de cualquiera de estas prohibiciones facultará
              a maTickets o al Organizador para la anulación inmediata de las
              entradas adquiridas, el bloqueo permanente del perfil del usuario
              y el ejercicio de las acciones civiles y penales correspondientes.
              La Plataforma no se hace responsable por daños y perjuicios
              derivados de actividades ilícitas ejecutadas por terceros.
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
            <p className="mt-2">
              Según la legislación venezolana, los datos personales solo serán
              revelados a petición de alguna solicitud judicial formulada
              directamente a la Plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Limitación de responsabilidad</h2>
            <p>
              maTickets provee únicamente la infraestructura tecnológica para
              la publicidad y comercialización de las entradas y no es
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
            <p className="mt-2">
              El uso indebido por parte de ellos será considerado fraudulento.
              Ni la Plataforma ni el Organizador serán responsables de dichos
              actos ejecutados por los menores o por terceros que sustraigan
              la identidad de mayores de edad para obtener un beneficio.
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
