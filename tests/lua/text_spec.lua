local text = require("neovim-pi.text")
local owned = require("neovim-pi.owned")
local mark = require("neovim-pi.mark")

--- Buffer preloaded with known lines.
local function buffer_with(lines)
  local bufnr = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
  return bufnr
end

--- Buffer pi owns, so the edit path will write it.
local function owned_buffer(lines)
  local bufnr = buffer_with(lines)
  owned.claim(bufnr)
  return bufnr
end

local function lines_of(bufnr)
  return vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
end

describe("neovim-pi.text", function()
  describe("get_range()", function()
    it("reads a single-line character range", function()
      local bufnr = buffer_with({ "hello world", "second" })
      local result = text.get_range(bufnr, 1, 0, 1, 5)
      assert.are.equal("hello", result.text)
    end)

    it("counts columns in characters, not bytes, across multibyte text", function()
      -- "héllo" is 5 characters but 6 bytes (é is two bytes).
      local bufnr = buffer_with({ "héllo wörld" })
      local result = text.get_range(bufnr, 1, 0, 1, 5)
      assert.are.equal("héllo", result.text)
    end)

    it("reads across multiple lines preserving newlines", function()
      local bufnr = buffer_with({ "alpha", "bravo", "charlie" })
      local result = text.get_range(bufnr, 1, 2, 3, 3)
      assert.are.equal("pha\nbravo\ncha", result.text)
    end)

    it("clamps an end column past end of line to the line length", function()
      local bufnr = buffer_with({ "hi" })
      local result = text.get_range(bufnr, 1, 0, 1, 99)
      assert.are.equal("hi", result.text)
    end)
  end)

  describe("set_range()", function()
    before_each(function()
      owned.clear()
    end)

    it("refuses a buffer pi does not own and leaves it untouched", function()
      local bufnr = buffer_with({ "keep me" })
      local result = text.set_range(bufnr, 1, 0, 1, 4, "GONE")
      assert.is_false(result.ok)
      assert.are.same({ "keep me" }, lines_of(bufnr))
    end)

    it("replaces a single-line range and bumps the changedtick", function()
      local bufnr = owned_buffer({ "hello world" })
      local before = vim.api.nvim_buf_get_changedtick(bufnr)
      local result = text.set_range(bufnr, 1, 0, 1, 5, "HELLO")
      assert.is_true(result.ok)
      assert.are.same({ "HELLO world" }, lines_of(bufnr))
      assert.is_true(result.changedtick > before)
    end)

    it("refuses on a changedtick mismatch without writing", function()
      local bufnr = owned_buffer({ "hello world" })
      local stale = vim.api.nvim_buf_get_changedtick(bufnr) - 1
      local result = text.set_range(bufnr, 1, 0, 1, 5, "HELLO", stale)
      assert.is_false(result.ok)
      assert.is_true(result.conflict)
      assert.are.same({ "hello world" }, lines_of(bufnr))
    end)

    it("applies when the expected changedtick matches", function()
      local bufnr = owned_buffer({ "hello world" })
      local tick = vim.api.nvim_buf_get_changedtick(bufnr)
      local result = text.set_range(bufnr, 1, 0, 1, 5, "HELLO", tick)
      assert.is_true(result.ok)
      assert.are.same({ "HELLO world" }, lines_of(bufnr))
    end)

    it("treats columns as characters on write across multibyte text", function()
      local bufnr = owned_buffer({ "héllo" })
      local result = text.set_range(bufnr, 1, 0, 1, 1, "H")
      assert.is_true(result.ok)
      assert.are.same({ "Héllo" }, lines_of(bufnr))
    end)

    it("reports the end position of a multi-line replacement", function()
      local bufnr = owned_buffer({ "hello world" })
      local result = text.set_range(bufnr, 1, 0, 1, 5, "a\nbb")
      assert.are.same({ "a", "bb world" }, lines_of(bufnr))
      assert.are.equal(2, result.end_line)
      assert.are.equal(2, result.end_col)
      assert.are.equal(2, result.lines)
    end)

    it("is undone as a single change", function()
      local bufnr = owned_buffer({ "hello world" })
      text.set_range(bufnr, 1, 0, 1, 5, "HELLO")
      vim.api.nvim_buf_call(bufnr, function()
        vim.cmd("undo")
      end)
      assert.are.same({ "hello world" }, lines_of(bufnr))
    end)

    it("flashes a highlight over the replacement", function()
      local bufnr = owned_buffer({ "hello world" })
      text.set_range(bufnr, 1, 0, 1, 5, "HELLO")
      -- The flash lives in its own namespace (idempotent by
      -- name), kept apart from the shared extmark namespace.
      local flash_ns = vim.api.nvim_create_namespace("neovim-pi-flash")
      local marks = vim.api.nvim_buf_get_extmarks(bufnr, flash_ns, 0, -1, {})
      assert.is_true(#marks >= 1)
    end)

    it("leaves shared-namespace extmarks untouched when the flash clears", function()
      local bufnr = owned_buffer({ "hello world" })
      -- An agent highlight placed through the extmark capability.
      mark.set(bufnr, 0, 0, 0, 5, "Search")
      -- An edit flashes and schedules its clear FLASH_MS later.
      text.set_range(bufnr, 1, 6, 1, 11, "there")
      -- Wait past the flash lifetime so its deferred clear runs.
      vim.wait(500, function()
        return false
      end)

      local survivors = vim.api.nvim_buf_get_extmarks(bufnr, mark.namespace(), 0, -1, {})
      assert.are.equal(1, #survivors)
    end)
  end)
end)
