import type { TrackerAccountData, TrackerSubData, TrackerTxData, TxAbout } from "./tracker";
import { monthOf } from "./tracker";

// SEPTEMBER 2026, AS THE STATEMENTS READ IT (PASSOFF 2026-09-19). Written
// once, by the "Import September Data" row, and never again: the row is gone
// the moment a transaction exists, so there is no second tap that doubles
// the ledger.
//
// This is real data, not a demo fixture. It is here rather than in a seed
// script because the person importing it is the person it belongs to, and
// the import is an action on his own screen with a receipt, not something
// that happens to his account while he is not looking.

/** [date, merchant, what the bank wrote, cents out, category, account] */
type SeedTx = [string, string, string, number, string, string];

export const SEED_ACCOUNTS: TrackerAccountData[] = [
  { name: "EVERYDAY CHECKING ...0860", type: "checking", currentBalanceCents: 129527, availableBalanceCents: 129527 },
  { name: "BUSINESS CHECKING ...3305", type: "checking", currentBalanceCents: 16380, availableBalanceCents: 16380 },
  { name: "WAY2SAVE SAVINGS ...3363", type: "savings", currentBalanceCents: 2651241, availableBalanceCents: 2651241 },
  { name: "PLATINUM CARD ...4975", type: "credit card", currentBalanceCents: 84268, availableBalanceCents: 914400 },
];

export const SEED_SUBS: TrackerSubData[] = [
  { merchantName: "Amazon Prime", amountCents: 1499, frequency: "Monthly", status: "active" },
  { merchantName: "Disney+", amountCents: 3189, frequency: "Monthly", status: "active" },
  { merchantName: "SiriusXM", amountCents: 1594, frequency: "Monthly", status: "active" },
];

const SEED_TX: SeedTx[] = [
  ["2026-09-15", "Amazon Prime", "Amazon Prime", 1499, "Subscription", "PLATINUM CARD ...4975"],
  ["2026-09-14", "Sterling Farms Golf Course", "Sterling Farms Golf Stamford CT", 1000, "Golf", "EVERYDAY CHECKING ...0860"],
  ["2026-09-14", "Uncorked", "Uncorked Stamford CT", 2319, "Restaurants", "EVERYDAY CHECKING ...0860"],
  ["2026-09-14", "Stamford Wine & Liquor", "Stamford Wine & Liquor Stamford CT", 2126, "Food and Beverage Store", "EVERYDAY CHECKING ...0860"],
  ["2026-09-13", "Stamford Wine & Liquor", "Stamford Wine & Liquor", 5009, "Food and Beverage Store", "PLATINUM CARD ...4975"],
  ["2026-09-13", "ShopRite", "ShopRite Newfield", 3297, "Supermarkets and Groceries", "PLATINUM CARD ...4975"],
  ["2026-09-12", "Apple", "Apple.com/bill", 3717, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-11", "Amazon", "Amazon Mktpl", 4996, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-11", "Apple", "Apple.com/bill", 1009, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-10", "Anthropic", "Anthropic.com", 2020, "Service", "EVERYDAY CHECKING ...0860"],
  ["2026-09-10", "Amazon", "Amazon Mktpl", 4243, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-09", "Apple", "Apple.com/bill", 3613, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-09", "SiriusXM", "SiriusXM Guardian NY", 1594, "Subscription", "EVERYDAY CHECKING ...0860"],
  ["2026-09-09", "Manhattan Youth", "Manhattan Youth New York NY", 3105, "Charities and Non-Profits", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "Blue Note", "Blue Note NY", 7991, "Restaurants", "PLATINUM CARD ...4975"],
  ["2026-09-08", "Street Taco", "Street Taco New York NY", 7901, "Restaurants", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "ZAZA Italian Gastrobar & Pizzeria", "ZAZA Italian Stamford CT", 5722, "Restaurants", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "The Brickhouse Bar & Grill", "Brick House Stamford CT", 4600, "Restaurants", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "Stop & Shop", "Stop & Shop Stamford CT", 4712, "Supermarkets and Groceries", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "Stamford Wine & Liquor", "Stamford Wine & Liquor Stamford CT", 4252, "Food and Beverage Store", "EVERYDAY CHECKING ...0860"],
  ["2026-09-08", "Chick-fil-A", "Chick-fil-A", 2214, "Fast Food", "EVERYDAY CHECKING ...0860"],
  ["2026-09-06", "Stamford Wine & Liquor", "Stamford Wine & Liquor", 1282, "Food and Beverage Store", "PLATINUM CARD ...4975"],
  ["2026-09-04", "Dick's Sporting Goods", "Dick's Sporting Goods", 722, "Sporting Goods", "PLATINUM CARD ...4975"],
  ["2026-09-03", "E. Gaynor Brennan Municipal Golf Course", "E Gaynor Brennan Golf", 13399, "Golf", "PLATINUM CARD ...4975"],
  ["2026-09-03", "Sterling Farms Golf Course", "Sterling Farms Golf Club", 500, "Golf", "PLATINUM CARD ...4975"],
  ["2026-09-03", "Chick-fil-A", "Chick-fil-A", 3410, "Fast Food", "BUSINESS CHECKING ...3305"],
  ["2026-09-02", "Amazon", "Amazon Mktpl", 6329, "Digital Purchase", "PLATINUM CARD ...4975"],
  ["2026-09-02", "Apple", "Apple.com/bill", 1487, "Digital Purchase", "PLATINUM CARD ...4975"],
];

// THE OVERDRAFT FEES, AS THE BANK CHARGED THEM (Dave, via Alfred, 2026-10-17).
//
// The first import carried three identical lines: "2026-09-01, Overdraft Fee,
// $35.00, BUSINESS CHECKING ...3305". Alfred pulled the account from Wells
// Fargo through Plaid and the bank's own record reads, verbatim: "The bank
// charged multiple DISTINCT $35 overdraft fees, each with its own transaction
// ID and its own underlying purchase: four dated Sep 1, 2026 (underlying
// purchases: MTA $19.00, MTA $10.25, ShopRite $23.51, MTA $14.25, all posted
// 08/31), one dated Sep 2 (Wienery $13.94 purchase on 09/01), and one dated
// Aug 26 (the Ally payment)."
//
// So the three rows were not one fee drawn three times; they were an
// undercount wearing one label. Each fee here carries the purchase it was
// charged for (`about`), the way the statement itself labels it, and a
// reference (`ref`) that tells it from the fee beside it.
//
// SIX, NOT FIVE (the follow-up order, 2026-10-17): the first pass kept the
// September statement's window (Sep 1 to 15) and left the Aug 26 fee out, so
// the app showed five of the bank's six. The window was the seed's own frame,
// not the bank's; the fee list now carries every fee the bank evidence names.
// The Aug 26 fee was charged for the Ally payment ($779.00); the evidence gives
// no posting day for it, so none is written and none is drawn.
export const FEE_ACCOUNT = "BUSINESS CHECKING ...3305";
export const FEE_MERCHANT = "Overdraft Fee";
export const FEE_CENTS = 3500;

/** [fee date, underlying merchant, underlying cents, posted date or none] */
type SeedFee = [string, string, number, string?];
const SEED_FEE: SeedFee[] = [
  ["2026-09-01", "MTA", 1900, "2026-08-31"],
  ["2026-09-01", "MTA", 1025, "2026-08-31"],
  ["2026-09-01", "ShopRite", 2351, "2026-08-31"],
  ["2026-09-01", "MTA", 1425, "2026-08-31"],
  ["2026-09-02", "Wienery", 1394, "2026-09-01"],
  ["2026-08-26", "Ally", 77900],
];

/** The stable synthetic reference for a fee we have no bank id for: the
 *  account's last digits, the fee's day, "od" and the purchase it was for.
 *  Deterministic, so the same fee on two phones is the same row. */
export function feeRef(account: string, date: string, about: TxAbout): string {
  const digits = account.match(/(\d{2,6})\s*$/)?.[1] ?? "acct";
  const slug = about.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `wf-${digits}-${date}-od-${slug}-${about.amountCents}`;
}

export const SEED_FEES: TrackerTxData[] = SEED_FEE.map(([date, merchant, amountCents, posted]) => {
  const about: TxAbout = posted ? { merchant, amountCents, date: posted } : { merchant, amountCents };
  return {
    date, month: monthOf(date), merchant: FEE_MERCHANT, name: "Overdraft fee business checking",
    amountCents: FEE_CENTS, category: "Overdraft", account: FEE_ACCOUNT,
    source: "import", about, ref: feeRef(FEE_ACCOUNT, date, about),
  };
});

/** A fee row from the first import: the bank's label missing, the three rows
 *  indistinguishable. Only ever an import row (a row typed by hand carries
 *  "manual"; a seed row before 2026-10-17 carried no source at all). */
export function isUnlabelledImportFee(d: TrackerTxData): boolean {
  return d.merchant === FEE_MERCHANT && d.date === "2026-09-01" && d.amountCents === FEE_CENTS && d.account === FEE_ACCOUNT
    && !d.ref && (d.source === undefined || d.source === "import");
}

export const SEED_TXS: TrackerTxData[] = [
  ...SEED_TX.map(([date, merchant, name, amountCents, category, account]): TrackerTxData => ({
    date, month: monthOf(date), merchant, name, amountCents, category, account,
  })),
  ...SEED_FEES,
];
