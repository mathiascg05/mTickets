import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import {
  ORGANIZER_TERMS_VERSION,
  ORGANIZER_TERMS_EFFECTIVE_DATE,
  LEGAL_CONTACT_EMAIL,
} from "@/lib/legalVersions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: lang, namespace: "seo.legal.termsOrganizer" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: lang === routing.defaultLocale ? "/terms-organizer" : `/${lang}/terms-organizer`,
      languages: { es: "/terms-organizer", en: "/en/terms-organizer" },
    },
  };
}

export default function OrganizerTermsPage() {
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
        <h1 className="text-3xl font-bold mb-2">
          Términos y Condiciones para Organizadores
        </h1>
        <p className="text-muted text-sm mb-8">
          Versión {ORGANIZER_TERMS_VERSION} · Vigente desde el{" "}
          {ORGANIZER_TERMS_EFFECTIVE_DATE}
        </p>

        <div className="space-y-6 text-foreground/80 leading-relaxed">
          <section>
            <p>
              Los presentes Términos rigen la relación entre <strong>maTickets</strong>
              (en adelante, &quot;la Plataforma&quot;) y las personas naturales o jurídicas
              que utilizan la Plataforma para publicar, vender y gestionar entradas
              de sus eventos (en adelante, &quot;el Organizador&quot;). Al registrarse
              como organizador, aceptar estos términos o publicar un evento, el
              Organizador declara haberlos leído, comprendido y aceptado
              íntegramente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">1. Naturaleza de la relación</h2>
            <p>
              El Organizador es el <strong>vendedor final</strong> de las entradas y
              el responsable único de la producción, ejecución y atención al
              comprador de su evento. maTickets provee exclusivamente la
              infraestructura tecnológica para publicar el evento, recibir solicitudes
              de compra, validar comprobantes y retransmitir las emisiones de
              entradas electrónicas del Organizador.
              maTickets no es agencia, mandatario, comisionista ni socio del
              Organizador y no percibe el dinero pagado por los compradores.
            </p>
            <p className="mt-2">
              maTickets es un servicio de software (SaaS) provisto por su
              operador. La Plataforma no constituye una agencia comercial, casa
              de cambio, procesador de pagos, ni emisor de documentos fiscales o
              títulos valores.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">2. Obligaciones del Organizador</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <strong>Veracidad del evento:</strong> publicar información exacta
                sobre fecha, hora, lugar, artistas, precios, capacidad y
                condiciones del evento. Cualquier modificación sustancial debe
                notificarse oportunamente a los compradores.
              </li>
              <li>
                <strong>Prestación del servicio:</strong> realizar el evento en los
                términos ofrecidos y garantizar el acceso a los compradores cuya
                entrada haya sido aprobada.
              </li>
              <li>
                <strong>Atención al comprador:</strong> gestionar las consultas,
                reclamos, reembolsos, cancelaciones y cambios de titularidad de
                sus eventos. maTickets no interviene en esa relación más allá de
                los canales de comunicación que habilita.
              </li>
              <li>
                <strong>Política de reembolso:</strong> definir y publicar su propia
                política de reembolsos y cumplirla. La política del Organizador
                prevalece entre el Organizador y el comprador; maTickets no se
                obliga ni responde por ella.
              </li>
              <li>
                <strong>Cumplimiento fiscal y regulatorio:</strong> el
                Organizador es el único y exclusivo responsable de cumplir con
                todas las obligaciones fiscales, tributarias, mercantiles,
                sanitarias, de propiedad intelectual y de cualquier otra
                naturaleza regulatoria que correspondan a las ventas y a la
                realización de su evento, en su jurisdicción. Esto incluye —sin
                limitación— la emisión de facturas, recibos o documentos
                equivalentes, la declaración y pago de los tributos aplicables,
                y la obtención de los registros, permisos y autorizaciones
                necesarios. El Organizador reconoce que{" "}
                <strong>
                  maTickets no emite facturas, no actúa como agente de retención
                  y no es responsable solidario
                </strong>{" "}
                de las obligaciones fiscales o regulatorias del Organizador
                frente a ninguna autoridad.
              </li>
              <li>
                <strong>Veracidad de datos bancarios y de pago:</strong> proveer
                datos precisos y actualizados para los métodos de pago
                configurados (Zelle, Pago Móvil, transferencia, efectivo u
                otros). El Organizador responde por los errores derivados de la
                información incorrecta.
              </li>
              <li>
                <strong>Tratamiento de datos personales de compradores:</strong>{" "}
                actuar como corresponsable del tratamiento, utilizar los datos
                exclusivamente para las finalidades propias del evento y
                garantizar su confidencialidad. El Organizador se obliga a
                cumplir la Política de Privacidad de la Plataforma y la normativa
                constitucional y legal venezolana sobre protección de datos.
              </li>
              <li>
                <strong>Legalidad del evento:</strong> obtener todos los permisos,
                licencias, derechos de autor, seguros y autorizaciones exigidos
                por ley para la realización del evento.
              </li>
              <li>
                <strong>Conducta:</strong> no utilizar la Plataforma para actos
                prohibidos por la Ley Especial contra los Delitos Informáticos,
                lavado de activos, eventos contrarios al orden público o
                normativa penal venezolana.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">
              3. Comisión por uso de la Plataforma
            </h2>
            <p>
              El uso de la Plataforma está sujeto al pago de una <strong>comisión</strong>{" "}
              a favor de maTickets configurable por evento, compuesta por un
              porcentaje sobre el precio de cada entrada{" "}
              <em>(feePercent)</em> y/o un monto fijo por orden{" "}
              <em>(feeFixed)</em>. Las tasas aplicables para cada evento se
              muestran al Organizador en el panel administrativo antes de su
              activación. Existen dos modalidades de cobro, según se defina para
              cada evento: <strong>Prepaid</strong> y <strong>Postpaid</strong>,
              regidas por las cláusulas siguientes.
            </p>

            <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">
              3.1 Modalidad Prepaid
            </h3>
            <p>
              La prestación de los servicios de comercialización por parte de
              maTickets queda sujeta al pago anticipado de las tarifas
              acordadas. Es responsabilidad exclusiva del Organizador mantener
              en todo momento un saldo positivo y solvente en su cuenta de
              gestión. El sistema solo habilitará la generación y entrega de
              códigos de accesibilidad de las entradas y/o tickets si la cuenta
              del Organizador presenta fondos suficientes para cubrir el costo
              del servicio prestado por maTickets.
            </p>
            <p className="mt-2">
              En caso de que el saldo sea insuficiente o inexistente, acarreará
              las siguientes consecuencias:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>
                No se generarán, activarán ni enviarán códigos de acceso bajo
                ninguna circunstancia.
              </li>
              <li>
                La plataforma de comercialización podrá quedar suspendida de
                forma automática hasta que se verifique el abono
                correspondiente.
              </li>
              <li>
                maTickets queda exenta de cualquier responsabilidad por
                reclamos de terceros o del público general ante la
                imposibilidad de acceder al evento por falta del pago del
                servicio por parte del Organizador.
              </li>
            </ul>

            <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">
              3.2 Modalidad Postpaid
            </h3>
            <p>
              Las partes podrán pactar de mutuo acuerdo la modalidad de pago
              posterior a la comercialización de entradas. El acceso a esta
              modalidad es excepcional y queda sujeto a la firma de un{" "}
              <strong>Contrato de Exclusividad</strong> y a la entrega previa
              de las garantías financieras aquí descritas.
            </p>
            <p className="mt-2">
              Para garantizar el pago de los servicios de esta modalidad
              postpaid, el Organizador se obliga a constituir y entregar a
              maTickets, con carácter obligatorio y previo al inicio de
              cualquier gestión, una <strong>Fianza Bancaria</strong> o{" "}
              <strong>Fianza de Fiel Cumplimiento</strong> otorgada por una
              empresa aseguradora de reconocida solvencia. Dicho instrumento
              deberá ser irrevocable, incondicional y de ejecución inmediata al
              primer requerimiento.
            </p>
            <p className="mt-2">
              La fianza deberá emitirse por un monto total que cubra, sin
              limitación alguna, los siguientes rubros:
            </p>
            <ol className="list-[upper-alpha] list-inside space-y-1 mt-1">
              <li>
                El cien por ciento (100%) del servicio derivado de la
                comercialización de la totalidad de las entradas previstas para
                el evento.
              </li>
              <li>
                El monto proyectado por concepto de intereses calculado a la
                tasa del uno por ciento (1%) calculados sobre el total
                establecido por el servicio, por un periodo de demora de hasta
                doce (12) meses.
              </li>
              <li>
                Una cantidad estimada para la cobertura de los gastos de
                cobranza, que debe ser del diez por ciento (10%) del monto
                total del contrato.
              </li>
              <li>
                Una cantidad adicional del veinte por ciento (20%) del monto
                total del contrato, destinada exclusivamente a cubrir los
                honorarios profesionales de los abogados.
              </li>
            </ol>
            <p className="mt-2">
              El Organizador acepta y reconoce que la generación, activación y
              entrega de los códigos de accesibilidad de las entradas y/o
              tickets, está supeditada a la vigencia y validez de esta
              garantía. Si la fianza o póliza no es entregada en los términos
              aquí exigidos, o si la entidad emisora pierde su calificación de
              solvencia, maTickets no generará los códigos de acceso, quedando
              facultado para suspender el servicio de inmediato sin que esto
              genere derecho a indemnización alguna a favor del Organizador.
            </p>
            <p className="mt-2">
              La garantía deberá mantenerse vigente hasta noventa (90) días
              hábiles después de concluido el evento. En caso de impago total o
              parcial al vencimiento de las obligaciones, maTickets procederá a
              la ejecución de la fianza por el total de los conceptos
              adeudados, incluyendo el veinte por ciento (20%) de honorarios
              legales preestablecido.
            </p>

            <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">
              3.3 Comisión no reembolsable
            </h3>
            <p>
              La comisión retribuye el servicio tecnológico efectivamente
              prestado por la Plataforma respecto de cada orden aprobada
              (procesamiento de la solicitud, validación de comprobante,
              reenvío de la entrada electrónica al Comprador y soporte técnico
              de la transacción). En consecuencia,{" "}
              <strong>la comisión es no reembolsable</strong> bajo ninguna
              circunstancia, incluyendo —sin limitación— la cancelación,
              suspensión, reprogramación o modificación del evento, los
              reembolsos que el Organizador efectúe a sus compradores, las
              disputas entre Organizador y Comprador, o el cierre voluntario de
              la cuenta del Organizador. El saldo prepaid no consumido podrá, a
              sola discreción de maTickets, aplicarse a comisiones de eventos
              futuros del mismo Organizador, pero no genera derecho a
              devolución en efectivo. Se exceptúan los casos de duplicación de
              cobro atribuible a un error técnico de la Plataforma, los cuales
              serán acreditados como saldo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">4. Obligaciones y límites de maTickets</h2>
            <p>maTickets se compromete a, de forma razonable:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Mantener la Plataforma disponible, sin acuerdos formales de nivel de servicio (SLA).</li>
              <li>Implementar medidas de seguridad razonables para la información almacenada.</li>
              <li>Proveer soporte técnico por los canales publicados.</li>
              <li>Notificar al Organizador cambios relevantes en funcionalidades o condiciones.</li>
            </ul>
            <p className="mt-2">
              maTickets no garantiza disponibilidad ininterrumpida y no es
              responsable por fallos derivados de proveedores de infraestructura
              de terceros, del Organizador o del comprador, ni por eventos de
              fuerza mayor.
            </p>
            <p className="mt-2">
              El servicio se provee <strong>&quot;tal cual&quot; (as-is)</strong>,
              sin garantías expresas ni implícitas de comerciabilidad,
              idoneidad para un fin particular, disponibilidad continua o
              resultados comerciales. La responsabilidad total acumulada de
              maTickets frente al Organizador, por cualquier causa, queda
              limitada al monto de comisiones efectivamente cobradas al
              Organizador con motivo de las entradas comercializadas por ese
              usuario, y las acciones caducarán a los seis (6) meses
              anteriores al hecho que origine el reclamo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">5. Propiedad intelectual</h2>
            <p>
              El Organizador conserva la titularidad de su marca, contenidos,
              imágenes y material publicado del evento, y otorga a maTickets una{" "}
              <strong>licencia limitada, no exclusiva, revocable y
              gratuita</strong> para mostrarlos en la Plataforma con el fin de
              publicitar y vender las entradas. maTickets es titular del software,
              diseño, código y marca &quot;maTickets&quot;, y no concede al Organizador
              derecho alguno sobre estos.
            </p>
            <p className="mt-2">
              Siendo esta autorización de uso de fotos, marcas o nombres no
              solo del Organizador, sino también de los eventos, artistas o
              cualquier otro derecho que pueda tener la promoción de las
              entradas entregadas para su comercialización, teniéndose la
              presunción de que el Organizador ya cuenta con las autorizaciones
              respectivas de los terceros ajenos a esta relación.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. Indemnidad</h2>
            <p>
              El Organizador <strong>mantiene indemne</strong> a maTickets frente a
              cualquier reclamo, demanda, sanción administrativa o indemnización
              derivada de: (a) el incumplimiento de sus obligaciones bajo estos
              Términos; (b) reclamos de compradores, artistas, proveedores o
              autoridades relacionados con el evento; (c) violaciones a derechos
              de terceros; (d) cualquier obligación fiscal, tributaria,
              contable, mercantil, laboral, sanitaria o regulatoria que recaiga
              sobre el Organizador o sobre el evento, ante cualquier autoridad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">7. Suspensión y terminación</h2>
            <p>
              maTickets podrá suspender o dar de baja la cuenta del Organizador,
              sin perjuicio de los derechos adquiridos por los compradores, en
              caso de:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Incumplimiento de estos Términos.</li>
              <li>Impago reiterado de comisiones.</li>
              <li>Indicios razonables de fraude, información falsa o eventos inexistentes.</li>
              <li>Reclamos sustentados de compradores o de autoridades.</li>
              <li>Uso de la Plataforma para finalidades ilícitas.</li>
            </ul>
            <p className="mt-2">
              Salvo casos graves, maTickets notificará previamente al Organizador
              otorgando un plazo razonable para subsanar. El Organizador puede
              terminar la relación en cualquier momento, previo cumplimiento de
              sus obligaciones pendientes (eventos en curso, comisiones
              devengadas, atención a compradores aprobados).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Confidencialidad</h2>
            <p>
              Cada parte se obliga a tratar como confidencial la información
              comercial, técnica o personal a la que acceda en virtud de la
              relación. Esta obligación subsiste tras la terminación.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">9. Modificaciones</h2>
            <p>
              maTickets podrá modificar estos Términos. Los cambios se comunicarán
              con al menos quince (15) días de antelación y pueden requerir nueva
              aceptación expresa por parte del Organizador para continuar
              utilizando la Plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">10. Ley aplicable y jurisdicción</h2>
            <p>
              Estos Términos se rigen por las leyes de la{" "}
              <strong>República Bolivariana de Venezuela</strong>. Para cualquier
              controversia, las partes se someten a los tribunales de la ciudad
              de Caracas, renunciando a cualquier otro fuero.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">11. Contacto</h2>
            <p>
              Consultas o notificaciones relacionadas con estos Términos:{" "}
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
          <Link href="/terms" className="text-accent-light hover:text-accent transition-colors">
            Términos del Comprador
          </Link>
          <Link href="/privacy" className="text-accent-light hover:text-accent transition-colors">
            Política de Privacidad
          </Link>
        </div>
      </main>
    </div>
  );
}
