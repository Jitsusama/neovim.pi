-- Window and tab awareness.
--
-- The agent reasons about an editor it cannot see, so it
-- needs a faithful picture of what is on screen: which
-- windows exist, what each shows, which one the human is
-- focused on and which one is pi's stage. This is read-only;
-- arranging and closing windows are separate verbs.

local M = {}

local stage = require("neovim-pi.stage")

--- Describe one window for the layout report.
---@param win integer
---@param current integer the focused window handle
---@param stage_win integer? pi's stage window handle
local function describe_window(win, current, stage_win)
  local bufnr = vim.api.nvim_win_get_buf(win)
  return {
    win = win,
    bufnr = bufnr,
    name = vim.api.nvim_buf_get_name(bufnr),
    modified = vim.bo[bufnr].modified,
    current = win == current,
    is_stage = stage_win ~= nil and win == stage_win,
  }
end

--- Report the window and tab layout.
---
--- Walks every tab and its windows so the agent can see the
--- whole screen, not just the current tab. The stage window
--- is flagged wherever it lives.
---@return table
function M.layout()
  local current = vim.api.nvim_get_current_win()
  local stage_win = stage.current()

  local tabs = {}
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    local windows = {}
    for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
      windows[#windows + 1] = describe_window(win, current, stage_win)
    end
    tabs[#tabs + 1] = {
      tabnr = vim.api.nvim_tabpage_get_number(tab),
      windows = windows,
    }
  end

  return {
    current_win = current,
    stage_win = stage_win,
    tabs = tabs,
  }
end

return M
