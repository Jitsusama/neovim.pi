local mark = require("neovim-pi.mark")

local function buffer_with_lines(lines)
  local bufnr = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
  return bufnr
end

--- Count extmarks neovim-pi owns in a buffer.
local function mark_count(bufnr)
  return #vim.api.nvim_buf_get_extmarks(bufnr, mark.namespace(), 0, -1, {})
end

describe("neovim-pi.mark", function()
  describe("set()", function()
    it("places a highlighted extmark over a range and returns its id", function()
      local bufnr = buffer_with_lines({ "alpha beta", "gamma delta" })
      local id = mark.set(bufnr, 0, 0, 0, 5, "Visual")
      assert.is_number(id)
      assert.are.equal(1, mark_count(bufnr))
      local details =
        vim.api.nvim_buf_get_extmark_by_id(bufnr, mark.namespace(), id, { details = true })
      assert.are.equal(0, details[3].end_row)
      assert.are.equal(5, details[3].end_col)
    end)
  end)

  describe("clear()", function()
    it("removes every neovim-pi extmark in the buffer", function()
      local bufnr = buffer_with_lines({ "one two three" })
      mark.set(bufnr, 0, 0, 0, 3, "Visual")
      mark.set(bufnr, 0, 4, 0, 7, "Visual")
      assert.are.equal(2, mark_count(bufnr))
      mark.clear(bufnr)
      assert.are.equal(0, mark_count(bufnr))
    end)

    it("does not error on a buffer with no marks", function()
      local bufnr = buffer_with_lines({ "clean" })
      assert.has_no.errors(function()
        mark.clear(bufnr)
      end)
    end)
  end)
end)
