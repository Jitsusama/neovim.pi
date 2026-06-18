local window = require("neovim-pi.window")
local stage = require("neovim-pi.stage")

local function reset_layout()
  stage.forget()
  local wins = vim.api.nvim_list_wins()
  for i = 2, #wins do
    pcall(vim.api.nvim_win_close, wins[i], true)
  end
  -- Collapse extra tabs too.
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    if tab ~= vim.api.nvim_list_tabpages()[1] then
      pcall(vim.cmd, "tabclose")
    end
  end
end

--- Find the window entry for a handle anywhere in the layout.
local function find_win(layout, win)
  for _, tab in ipairs(layout.tabs) do
    for _, w in ipairs(tab.windows) do
      if w.win == win then
        return w
      end
    end
  end
end

describe("neovim-pi.window", function()
  before_each(reset_layout)

  describe("layout()", function()
    it("reports the focused window", function()
      local layout = window.layout()
      assert.are.equal(vim.api.nvim_get_current_win(), layout.current_win)
      local entry = find_win(layout, layout.current_win)
      assert.is_true(entry.current)
    end)

    it("lists every window in the current tab", function()
      vim.cmd("vsplit")
      local layout = window.layout()
      local count = 0
      for _, tab in ipairs(layout.tabs) do
        count = count + #tab.windows
      end
      assert.are.equal(#vim.api.nvim_list_wins(), count)
    end)

    it("flags pi's stage window", function()
      local stage_win = stage.ensure()
      local layout = window.layout()
      assert.are.equal(stage_win, layout.stage_win)
      assert.is_true(find_win(layout, stage_win).is_stage)
    end)

    it("carries each window's buffer name and dirty flag", function()
      local bufnr = vim.api.nvim_get_current_buf()
      vim.api.nvim_buf_set_name(bufnr, "/tmp/named-buffer")
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "dirty now" })
      local entry = find_win(window.layout(), vim.api.nvim_get_current_win())
      assert.is_true(entry.name:match("named%-buffer") ~= nil)
      assert.is_true(entry.modified)
    end)
  end)

  describe("close()", function()
    it("closes a window pi owns", function()
      local win = stage.open("vsplit")
      local result = window.close(win)
      assert.is_true(result.ok)
      assert.is_false(vim.api.nvim_win_is_valid(win))
    end)

    it("refuses to close a window pi does not own", function()
      local human = vim.api.nvim_get_current_win()
      stage.ensure()
      local result = window.close(human)
      assert.is_false(result.ok)
      assert.is_true(vim.api.nvim_win_is_valid(human))
    end)
  end)

  describe("focus()", function()
    it("moves the focus to a valid window", function()
      local target = stage.open("vsplit")
      local result = window.focus(target)
      assert.is_true(result.ok)
      assert.are.equal(target, vim.api.nvim_get_current_win())
    end)

    it("refuses an invalid window handle", function()
      local human = vim.api.nvim_get_current_win()
      local result = window.focus(999999)
      assert.is_false(result.ok)
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)
  end)
end)
