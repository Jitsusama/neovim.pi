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
  after_each(function()
    cursor.unwatch()
  end)

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

  describe("get()", function()
    it("reports the cursor position and buffer for a window", function()
      local win, bufnr = window_with_lines({ "first", "second", "third" })
      cursor.set(win, 2, 3)
      local info = cursor.get(win)
      assert.are.equal(win, info.win)
      assert.are.equal(bufnr, info.bufnr)
      assert.are.equal(2, info.line)
      assert.are.equal(3, info.col)
      assert.is_string(info.mode)
    end)

    it("treats window 0 as the current window", function()
      local win = window_with_lines({ "alpha", "bravo" })
      cursor.set(0, 1, 2)
      local info = cursor.get(0)
      assert.are.equal(win, info.win)
      assert.are.equal(1, info.line)
      assert.are.equal(2, info.col)
    end)
  end)

  --- Start the stream with a capturing sink and return the
  --- list it appends each pushed snapshot to.
  local function watch_into(debounce_ms)
    local seen = {}
    cursor.watch({
      debounce_ms = debounce_ms,
      sink = function(p)
        table.insert(seen, p)
      end,
    })
    return seen
  end

  local function fire()
    vim.api.nvim_exec_autocmds("CursorMoved", {})
  end

  describe("watch()", function()
    it("emits a human-sourced snapshot when the cursor moves", function()
      local win = window_with_lines({ "one", "two", "three" })
      cursor.set(win, 3, 1)
      local seen = watch_into(0)
      fire()

      assert.are.equal(1, #seen)
      assert.are.equal(3, seen[1].line)
      assert.are.equal(1, seen[1].col)
      assert.are.equal("human", seen[1].source)
    end)

    it("does not emit while pi's own changes are suppressed", function()
      window_with_lines({ "a", "b" })
      local seen = watch_into(0)
      cursor.suppress(fire)

      assert.are.equal(0, #seen)
    end)

    it("resumes emitting after a suppressed block ends", function()
      window_with_lines({ "a", "b" })
      local seen = watch_into(0)
      cursor.suppress(function() end)
      fire()

      assert.are.equal(1, #seen)
    end)

    it("stops emitting after unwatch", function()
      window_with_lines({ "a", "b" })
      local seen = watch_into(0)
      cursor.unwatch()
      fire()

      assert.are.equal(0, #seen)
    end)

    it("coalesces rapid moves into a single debounced emit", function()
      window_with_lines({ "a", "b", "c" })
      local seen = watch_into(20)
      fire()
      fire()
      fire()
      vim.wait(200, function()
        return #seen > 0
      end)

      assert.are.equal(1, #seen)
    end)
  end)
end)
