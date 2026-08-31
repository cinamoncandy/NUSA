import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";
class S{async transaction<T>(cb:(txn:LiveRuntimeSessionStorageTransaction)=>Promise<T>):Promise<T>{return cb({get:async()=>undefined,put:async()=>undefined})}}
describe("final reservation missing session",()=>{it("fails closed",async()=>{const store=new LiveRuntimeSessionDurableStore(new S());expect(await store.reserveFinalExecution("o","s",1,"6".repeat(64),1)).toEqual({status:"REJECTED",reason:"AUTHORITATIVE_SESSION_UNAVAILABLE"});});});
