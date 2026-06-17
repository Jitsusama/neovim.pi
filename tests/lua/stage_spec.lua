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
end)
