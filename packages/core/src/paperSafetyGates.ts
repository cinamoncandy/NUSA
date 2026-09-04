import { createHash } from "node:crypto";
import type { PaperLedgerEntry } from "./paperBroker";
export type PaperMode = "PAPER_MANUAL" | "SHADOW" | "CANARY";
export interface DeploymentManifest { readonly appVersion:string; readonly commitSha:string; readonly strategyFingerprint:string; readonly configFingerprint:string; readonly runtimeFingerprint:string; readonly riskPolicyFingerprint:string; readonly mainVersion:string; readonly preloadVersion:string; readonly rendererVersion:string; readonly assets:readonly {readonly name:string;readonly sha256:string;readonly stale?:boolean}[]; }
export interface TradingApproval { readonly approvalId:string; readonly mode:PaperMode; readonly approvedBy:string; readonly approvedAt:number; readonly expiresAt:number; readonly allowedSymbol:string; readonly strategyFingerprint:string; readonly configFingerprint:string; readonly runtimeFingerprint:string; readonly riskPolicyFingerprint:string; readonly maximumOrders:number; readonly maximumCompletedTrades:number; readonly maximumSessionLoss:number; readonly maximumSessionDuration:number; }
export const sha=(x:unknown)=>createHash("sha256").update(JSON.stringify(x),"utf8").digest("hex");
export function verifyDeployment(expected:DeploymentManifest, actual:DeploymentManifest):readonly string[]{const out:string[]=[];for(const k of ["appVersion","commitSha","strategyFingerprint","configFingerprint","runtimeFingerprint","riskPolicyFingerprint","mainVersion","preloadVersion","rendererVersion"] as const)if(expected[k]!==actual[k])out.push(`DEPLOYMENT_${k.toUpperCase()}_MISMATCH`);const names=new Set(actual.assets.map(a=>a.name));for(const asset of expected.assets){const found=actual.assets.find(a=>a.name===asset.name);if(!found)out.push(`MISSING_ASSET:${asset.name}`);else if(found.sha256!==asset.sha256||found.stale)out.push(`STALE_ASSET:${asset.name}`)}for(const name of names)if(!expected.assets.some(a=>a.name===name))out.push(`UNEXPECTED_ASSET:${name}`);return Object.freeze(out.sort());}
export function verifyApproval(approval:TradingApproval|undefined, manifest:DeploymentManifest, symbol:string, now:number):readonly string[]{if(!approval)return Object.freeze(["APPROVAL_MISSING"]);const out:string[]=[];if(approval.expiresAt<now)out.push("APPROVAL_EXPIRED");if(approval.allowedSymbol!==symbol)out.push("APPROVAL_SCOPE_MISMATCH");for(const k of ["strategyFingerprint","configFingerprint","runtimeFingerprint","riskPolicyFingerprint"] as const)if(approval[k]!==manifest[k])out.push(`APPROVAL_${k.toUpperCase()}_MISMATCH`);return Object.freeze(out.sort());}
export function shadowMutationAllowed(mode:PaperMode):boolean{return mode!=="SHADOW";}
export function canaryAllowed(approval:TradingApproval|undefined, orders:number,trades:number,loss:number,elapsed:number):boolean{return !!approval&&approval.mode==="CANARY"&&orders<approval.maximumOrders&&trades<approval.maximumCompletedTrades&&loss<=approval.maximumSessionLoss&&elapsed<=approval.maximumSessionDuration;}
export interface LedgerOrder {readonly id:string;readonly side:"BUY"|"SELL";readonly quantity:number;readonly price:number;readonly fee:number;readonly filledAt:string;}
export function reconcilePaperLedger(orders:readonly LedgerOrder[], initialCash:number, markPrice:number){let cash=initialCash,qty=0,avg=0,realized=0,fees=0;const errors:string[]=[];const seen=new Set<string>();for(const o of [...orders].sort((a,b)=>a.filledAt.localeCompare(b.filledAt)||a.id.localeCompare(b.id))){if(seen.has(o.id)){errors.push(`DUPLICATE_FILL:${o.id}`);continue}seen.add(o.id);if(!Number.isFinite(o.quantity)||o.quantity<=0||!Number.isFinite(o.price)||o.price<=0||!Number.isFinite(o.fee)||o.fee<0){errors.push(`INVALID_FILL:${o.id}`);continue}const n=o.quantity*o.price;fees+=o.fee;if(o.side==="BUY"){cash-=n+o.fee;avg=(avg*qty+n)/(qty+o.quantity);qty+=o.quantity}else if(o.quantity>qty){errors.push(`ORPHAN_FILL:${o.id}`)}else{cash+=n-o.fee;realized+=(o.price-avg)*o.quantity-o.fee;qty-=o.quantity;if(qty===0)avg=0}}const unrealized=qty*(markPrice-avg);return Object.freeze({healthy:errors.length===0,errors:Object.freeze(errors),cash,quantity:qty,averagePrice:avg,fees,realizedPnl:realized,unrealizedPnl:unrealized,equity:cash+qty*markPrice});}

export function replayPaperLedger(entries: readonly PaperLedgerEntry[], initialCash: number, markPrice: number) {
  if (!Number.isFinite(initialCash) || initialCash < 0 || !Number.isFinite(markPrice) || markPrice <= 0) throw new Error("invalid ledger projection input");
  // Float dust grows with magnitude (~1e-16 relative), so an absolute-only
  // tolerance false-halts healthy large-scale ledgers (reproduced: a valid
  // 1e9-scale ledger mismatched by the 5th fill under 1e-8 absolute).
  // The floor preserves today's strictness at ordinary magnitudes; the
  // relative term keeps detection meaningful where absolute noise is
  // physically unavoidable. This is a correctness fix, not a relaxation:
  // economically meaningful drift still throws at every scale.
  const tolerance = (a: number, b: number, floor: number): number =>
    Math.max(floor, 1e-12 * Math.max(Math.abs(a), Math.abs(b), 1));
  let cash = initialCash;
  let quantity = 0;
  let averagePrice = 0;
  let realizedPnl = 0;
  let fees = 0;
  let previousSequence = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.sequence !== previousSequence + 1) throw new Error("ledger sequence mismatch");
    if (seen.has(entry.fillId)) throw new Error(`duplicate ledger fill: ${entry.fillId}`);
    if (!Number.isFinite(entry.quantity) || entry.quantity <= 0 || !Number.isFinite(entry.price) || entry.price <= 0 || !Number.isFinite(entry.fee) || entry.fee < 0) throw new Error(`invalid ledger entry: ${entry.fillId}`);
    if (Math.abs(entry.cashBefore - cash) > tolerance(entry.cashBefore, cash, 1e-8) || Math.abs(entry.positionQuantityBefore - quantity) > tolerance(entry.positionQuantityBefore, quantity, 1e-12)) throw new Error(`ledger before-state mismatch: ${entry.fillId}`);
    seen.add(entry.fillId);
    const notional = entry.quantity * entry.price;
    if (entry.side === "BUY") {
      cash -= notional + entry.fee;
      averagePrice = (averagePrice * quantity + notional) / (quantity + entry.quantity);
      quantity += entry.quantity;
    } else {
      if (entry.quantity > quantity) throw new Error(`ledger sell exceeds position: ${entry.fillId}`);
      cash += notional - entry.fee;
      realizedPnl += (entry.price - averagePrice) * entry.quantity - entry.fee;
      quantity -= entry.quantity;
      if (quantity === 0) averagePrice = 0;
    }
    fees += entry.fee;
    if (Math.abs(entry.cashAfter - cash) > tolerance(entry.cashAfter, cash, 1e-8) || Math.abs(entry.positionQuantityAfter - quantity) > tolerance(entry.positionQuantityAfter, quantity, 1e-12) || Math.abs(entry.realizedPnlAfter - realizedPnl) > tolerance(entry.realizedPnlAfter, realizedPnl, 1e-8)) throw new Error(`ledger after-state mismatch: ${entry.fillId}`);
    previousSequence = entry.sequence;
  }
  const unrealizedPnl = quantity * (markPrice - averagePrice);
  return Object.freeze({ cash, quantity, averagePrice, realizedPnl, unrealizedPnl, fees, equity: cash + quantity * markPrice });
}
