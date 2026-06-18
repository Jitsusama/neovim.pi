local stage = require("neovim-pi.stage")

--- Collapse back to a single window and drop pi's claim so each
--- example starts from a known layout.
local function reset_layout()
  stage.forget()
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    if win ~= vim.api.nvim_list_wins()[1] then
      pcall(vim.api.nvim_win_close, win, true)
    end
  end
end

describe("neovim-pi.stage", function()
  before_each(reset_layout)

  describe("ensure()", function()
    it("creates a stage window without stealing the human's focus", function()
      local human = vim.api.nvim_get_current_win()
      local win = stage.ensure()
      assert.is_true(vim.api.nvim_win_is_valid(win))
      assert.are_not.equal(human, win)
      assert.are.equal(human, vim.api.nvim_get_current_win())
      assert.are.equal(2, #vim.api.nvim_list_wins())
    end)

    it("returns the same window on a repeat call", function()
      local first = stage.ensure()
      local second = stage.ensure()
      assert.are.equal(first, second)
      assert.are.equal(2, #vim.api.nvim_list_wins())
    end)

    it("recreates the stage window after it was closed", function()
      local first = stage.ensure()
      vim.api.nvim_win_close(first, true)
      local second = stage.ensure()
      assert.is_true(vim.api.nvim_win_is_valid(second))
      assert.are_not.equal(first, second)
    end)

    it("wipes its throwaway scratch when a real buffer replaces it", function()
      local win = stage.ensure()
      local scratch = vim.api.nvim_win_get_buf(win)

      -- Displace the scratch the way file.open and diff do.
      vim.api.nvim_win_set_buf(win, vim.api.nvim_create_buf(true, false))

      assert.is_false(vim.api.nvim_buf_is_valid(scratch))
    end)
  end)

  describe("current()", function()
    it("is nil before any stage window exists", function()
      assert.is_nil(stage.current())
    end)

    it("reports the live stage window once ensured", function()
      local win = stage.ensure()
      assert.are.equal(win, stage.current())
    end)
  end)

  describe("forget()", function()
    it("drops pi's claim without closing the window", function()
      local win = stage.ensure()
      stage.forget()
      assert.is_nil(stage.current())
      assert.is_true(vim.api.nvim_win_is_valid(win))
    end)
  end)

  describe("open()", function()
    it("opens a split beside the stage without stealing focus", function()
      local human = vim.api.nvim_get_current_win()
      local win = stage.open("split")
      assert.is_true(vim.api.nvim_win_is_valid(win))
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)

    it("opens a vsplit pi owns", function()
      local win = stage.open("vsplit")
      assert.is_true(stage.owns(win))
    end)
  end)

  describe("owns()", function()
    it("owns the stage window and windows it opened", function()
      local primary = stage.ensure()
      local extra = stage.open("split")
      assert.is_true(stage.owns(primary))
      assert.is_true(stage.owns(extra))
    end)

    it("does not own the human's window", function()
      local human = vim.api.nvim_get_current_win()
      stage.ensure()
      assert.is_false(stage.owns(human))
    end)

    it("stops owning a window after forget", function()
      local win = stage.open("split")
      stage.forget()
      assert.is_false(stage.owns(win))
    end)
  end)
end)
