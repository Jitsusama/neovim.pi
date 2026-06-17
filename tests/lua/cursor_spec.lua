local cursor = require("neovim-pi.cursor")

--- Build a scratch buffer with known lines and show it in a
--- window so cursor positions are well defined.
local function window_with_lines(lines)
  local bufnr = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
  local win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(win, bufnr)
  return win, bufnr
end

describe("neovim-pi.cursor", function()
  describe("set()", function()
    it("moves the cursor to the given line and column in a window", function()
      local win = window_with_lines({ "first line", "second line", "third line" })
      cursor.set(win, 2, 3)
      local pos = vim.api.nvim_win_get_cursor(win)
      assert.are.same({ 2, 3 }, pos)
    end)

    it("treats window 0 as the current window", function()
      local win = window_with_lines({ "alpha", "bravo" })
      cursor.set(0, 1, 2)
      assert.are.same({ 1, 2 }, vim.api.nvim_win_get_cursor(win))
    end)

    it("clamps a column past end of line instead of erroring", function()
      local win = window_with_lines({ "hi", "there" })
      assert.has_no.errors(function()
        cursor.set(win, 1, 99)
      end)
      -- "hi" has length 2; the cursor should land no further than the
      -- last byte rather than raising an out-of-range error.
      local col = vim.api.nvim_win_get_cursor(win)[2]
      assert.is_true(col <= 2)
    end)
  end)
end)
