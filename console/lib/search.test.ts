import assert from "node:assert/strict";
import test from "node:test";
import { matchesSearch, searchTerms } from "./search.ts";

test("comma, semicolon or newline separated queries match any term", () => {
  assert.deepEqual(searchTerms("6QM8N72HMA0041, 6qm8n72hma0084；6QL8N72HMA0122\n6QM8N72HMA0041"), ["6qm8n72hma0041", "6qm8n72hma0084", "6ql8n72hma0122"]);
  assert.deepEqual(searchTerms("  Gigabyte G894 "), ["gigabyte g894"]);
  assert.deepEqual(searchTerms(" , "), []);
  const terms = searchTerms("SN-A, SN-B");
  assert.equal(matchesSearch("RS-1 sn-b G894", terms), true);
  assert.equal(matchesSearch("RS-2 SN-C", terms), false);
  assert.equal(matchesSearch("anything", []), true);
});
