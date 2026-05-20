"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  CEDULA_PREFIXES,
  PHONE_PREFIXES,
  VENEZUELAN_BANKS,
  formatBank,
  formatCedula,
  formatPhone,
  parseBank,
  parseCedula,
  parsePhone,
  type CedulaPrefix,
  type PhonePrefix,
} from "@/lib/pago-movil";

type Props = {
  pmCedula: string;
  pmPhone: string;
  pmBank: string;
  onCedulaChange: (next: string) => void;
  onPhoneChange: (next: string) => void;
  onBankChange: (next: string) => void;
};

const inputClass =
  "w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm";
const selectClass =
  "px-2 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm";
const labelClass = "block text-sm font-medium mb-1";

export function PagoMovilFields({
  pmCedula,
  pmPhone,
  pmBank,
  onCedulaChange,
  onPhoneChange,
  onBankChange,
}: Props) {
  const { t } = useLanguage();

  const cedula = parseCedula(pmCedula);
  const phone = parsePhone(pmPhone);
  const bank = parseBank(pmBank);

  const [isCustomBank, setIsCustomBank] = useState(
    () => bank.code === null && bank.name !== "",
  );

  function handleBankSelect(code: string) {
    if (code === "__other__") {
      setIsCustomBank(true);
      onBankChange(formatBank({ code: null, name: bank.name }));
      return;
    }
    setIsCustomBank(false);
    const found = VENEZUELAN_BANKS.find((b) => b.code === code);
    if (found) {
      onBankChange(formatBank({ code: found.code, name: found.name }));
    } else {
      onBankChange("");
    }
  }

  const bankSelectValue = isCustomBank
    ? "__other__"
    : bank.code && VENEZUELAN_BANKS.some((b) => b.code === bank.code)
      ? bank.code
      : "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className={labelClass}>{t("admin.pmCedula")}</label>
        <div className="flex gap-1">
          <select
            value={cedula.prefix}
            onChange={(e) =>
              onCedulaChange(
                formatCedula({
                  prefix: e.target.value as CedulaPrefix,
                  digits: cedula.digits,
                }),
              )
            }
            className={selectClass}
          >
            {CEDULA_PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            value={cedula.digits}
            inputMode="numeric"
            onChange={(e) =>
              onCedulaChange(
                formatCedula({
                  prefix: cedula.prefix,
                  digits: e.target.value.replace(/\D/g, ""),
                }),
              )
            }
            className={`${inputClass} flex-1`}
            placeholder={t("admin.pmCedulaDigitsPlaceholder")}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>{t("admin.pmPhone")}</label>
        <div className="flex gap-1">
          <select
            value={phone.prefix}
            onChange={(e) =>
              onPhoneChange(
                formatPhone({
                  prefix: e.target.value as PhonePrefix,
                  rest: phone.rest,
                }),
              )
            }
            className={selectClass}
          >
            {PHONE_PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            value={phone.rest}
            inputMode="numeric"
            maxLength={7}
            onChange={(e) =>
              onPhoneChange(
                formatPhone({
                  prefix: phone.prefix,
                  rest: e.target.value.replace(/\D/g, ""),
                }),
              )
            }
            className={`${inputClass} flex-1`}
            placeholder={t("admin.pmPhoneRestPlaceholder")}
          />
        </div>
      </div>
      </div>

      <div>
        <label className={labelClass}>{t("admin.pmBank")}</label>
        <select
          value={bankSelectValue}
          onChange={(e) => handleBankSelect(e.target.value)}
          className={`${inputClass}`}
        >
          <option value="">—</option>
          {VENEZUELAN_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} · {b.name}
            </option>
          ))}
          <option value="__other__">{t("admin.pmBankOther")}</option>
        </select>
        {isCustomBank && (
          <input
            value={bank.name}
            onChange={(e) =>
              onBankChange(formatBank({ code: null, name: e.target.value }))
            }
            placeholder={t("admin.pmBankCustomPlaceholder")}
            className={`${inputClass} mt-1`}
          />
        )}
      </div>
    </div>
  );
}
