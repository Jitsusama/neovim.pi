-- Ledger of buffers pi opened.
--
-- pi edits only buffers it opened itself. That is the line
-- that keeps pi out of the human's hidden, dirty buffers: a
-- file the human loaded and pi never touched is not pi's to
-- write. The edit path consults this ledger before any
-- mutation and refuses a buffer it does not own.

local M = {}

---@type table<integer, boolean>
local owned = {}

--- Record that pi opened a buffer.
---@param bufnr integer
function M.claim(bufnr)
  owned[bufnr] = true
end

--- Forget a single buffer (it was closed, or pi gave it up).
---@param bufnr integer
function M.release(bufnr)
  owned[bufnr] = nil
end

--- Whether pi opened this buffer.
---@param bufnr integer
---@return boolean
function M.has(bufnr)
  return owned[bufnr] == true
end

--- Forget every claim. Called when pi detaches.
function M.clear()
  owned = {}
end

return M
