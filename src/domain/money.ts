import { DomainError } from "./errors";

export type Cents = number;

const USD_PATTERN = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * Ensures a numeric value is a safe integer representing USD cents.
 */
export function assertIntegerCents(value: number, label = "amountCents"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError(
      "INVALID_MONEY",
      `${label} must be a safe integer number of cents, received ${String(value)}.`
    );
  }
  return value;
}

/**
 * Parses a USD currency string (e.g. "$24.00", "1,234.56", "-$5.05") into integer cents
 * using pure integer parsing without floating-point multiplication.
 */
export function parseUsdToCents(input: string): Cents {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DomainError("INVALID_MONEY", "USD amount cannot be empty.");
  }

  let body = trimmed;
  let negative = false;

  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1).trim();
  }
  if (body.startsWith("$")) {
    body = body.slice(1).trim();
    if (body.startsWith("-") && !negative) {
      negative = true;
      body = body.slice(1).trim();
    }
  }

  const match = USD_PATTERN.exec(body);
  if (!match) {
    throw new DomainError("INVALID_MONEY", `Invalid USD amount: "${input}".`);
  }

  const [wholePart = "", fracPart = ""] = body.split(".");
  const wholeDigits = wholePart.replaceAll(",", "");
  const dollars = Number.parseInt(wholeDigits, 10);
  const cents = Number.parseInt(fracPart.padEnd(2, "0"), 10);
  const absTotal = dollars * 100 + cents;

  if (!Number.isSafeInteger(absTotal)) {
    throw new DomainError("INVALID_MONEY", `USD amount overflows safe integer range: "${input}".`);
  }

  if (absTotal === 0) {
    return 0;
  }
  return negative ? -absTotal : absTotal;
}

function splitCents(cents: Cents): { negative: boolean; dollars: number; remainder: number } {
  assertIntegerCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const remainder = abs % 100;
  const dollars = (abs - remainder) / 100;
  return { negative, dollars, remainder };
}

/**
 * Formats integer cents as a user-friendly USD string (e.g. "$24.00", "-$5.05").
 */
export function formatCentsToUsd(cents: Cents): string {
  const { negative, dollars, remainder } = splitCents(cents);
  const groupedDollars = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const paddedCents = String(remainder).padStart(2, "0");
  return `${negative ? "-" : ""}$${groupedDollars}.${paddedCents}`;
}

/**
 * Formats integer cents as a plain 2-decimal USD string (e.g. "24.00") for APIs.
 */
export function formatCentsToDecimal(cents: Cents): string {
  const { negative, dollars, remainder } = splitCents(cents);
  const paddedCents = String(remainder).padStart(2, "0");
  return `${negative ? "-" : ""}${dollars}.${paddedCents}`;
}

export function addCents(a: Cents, b: Cents): Cents {
  assertIntegerCents(a, "left operand");
  assertIntegerCents(b, "right operand");
  return assertIntegerCents(a + b, "sum");
}

export function subtractCents(a: Cents, b: Cents): Cents {
  assertIntegerCents(a, "left operand");
  assertIntegerCents(b, "right operand");
  return assertIntegerCents(a - b, "difference");
}

export function multiplyCents(unitPriceCents: Cents, quantity: number): Cents {
  assertIntegerCents(unitPriceCents, "unitPriceCents");
  if (!Number.isSafeInteger(quantity)) {
    throw new DomainError(
      "INVALID_MONEY",
      `quantity must be a safe integer, received ${String(quantity)}.`
    );
  }
  return assertIntegerCents(unitPriceCents * quantity, "product");
}
