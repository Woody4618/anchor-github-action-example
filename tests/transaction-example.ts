import { getProvider, Program } from "@coral-xyz/anchor";
import { getKeypairFromFile } from "@solana-developers/helpers";
import { TransactionExample } from "../target/types/transaction_example";
import {
  sendTransactionWithRetry,
  prepareTransactionWithCompute,
  getIdlParsedAccountData,
  parseAnchorTransactionEvents,
  decodeAnchorTransaction,
} from "/Users/jonasmac2/Documents/GitHub/helpers/src/lib/transaction";
import { Connection, PublicKey } from "@solana/web3.js";
import { strict as assert } from "assert";
const anchor = require("@coral-xyz/anchor");

describe("send-transaction", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .TransactionExample as Program<TransactionExample>;

  it("Is initialized!", async () => {
    const keyPair = await getKeypairFromFile();

    const tx = await program.methods.initialize().transaction();
    const connection = new Connection(
      anchor.getProvider().connection.rpcEndpoint,
      "confirmed"
    );

    const blockhash = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash.blockhash;
    tx.feePayer = anchor.getProvider().publicKey;

    // This could be really nice if RPC providers would all have the same API...
    // Please fall back to the fee api of your favourite RPC provider to get a good value.
    const priorityFee = 1000;

    await prepareTransactionWithCompute(
      connection,
      tx,
      keyPair.publicKey,
      priorityFee
    );

    tx.sign(keyPair);

    // This is how to subscribe to events in anchor
    const subscriptionId = await program.addEventListener(
      "counterEvent",
      (event) => {
        console.log("CounterEvent", event);
      }
    );

    var signature = await sendTransactionWithRetry(connection, tx, []);
    console.log("Your transaction signature", signature);

    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
    });
    console.log("Transaction", transaction);

    // --- Decode Transaction ---
    const decodedTx = await decodeAnchorTransaction(
      "./target/idl/transaction_example.json",
      signature,
      connection
    );

    console.log(decodedTx.toString());

    // --- Parse Events ---
    const events = await parseAnchorTransactionEvents(
      "./target/idl/transaction_example.json",
      signature,
      connection
    );
    console.log("Events:", events);

    // --- Parse Account Data ---

    const counterPdaPubkey = PublicKey.findProgramAddressSync(
      [Buffer.from("counter")],
      program.programId
    )[0];

    const decodedCounterData = await getIdlParsedAccountData(
      "./target/idl/transaction_example.json",
      "counter",
      counterPdaPubkey,
      connection
    );
    console.log("Decoded Data:", decodedCounterData);

    await program.removeEventListener(subscriptionId);
  });

  it("Get and parse counter!", async () => {
    const connection = new Connection(
      anchor.getProvider().connection.rpcEndpoint,
      "confirmed"
    );

    const counterPdaPubkey = PublicKey.findProgramAddressSync(
      [Buffer.from("counter")],
      program.programId
    )[0];

    const decodedData = await getIdlParsedAccountData(
      "./target/idl/transaction_example.json",
      "counter",
      counterPdaPubkey,
      connection
    );

    assert(
      decodedData.count == 2,
      `Expected count to be 0 but got ${decodedData.count}`
    );
  });
});
