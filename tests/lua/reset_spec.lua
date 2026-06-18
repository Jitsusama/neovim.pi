local neovim_pi = require("neovim-pi")
local owned = require("neovim-pi.owned")
local stage = require("neovim-pi.stage")
local cursor = require("neovim-pi.cursor")

local function reset_layout()
  stage.forget()
  owned.clear()
  cursor.unwatch()
  local wins = vim.api.nvim_list_wins()
  for i = 2, #wins do
    pcall(vim.api.nvim_win_close, wins[i], true)
  end
end

describe("neovim-pi.reset", function()
  after_each(reset_layout)

  it("drops the ownership ledger and forgets pi's stage windows", function()
    local buf = vim.api.nvim_create_buf(false, true)
    owned.claim(buf)
    stage.ensure()
    assert.is_true(owned.has(buf))
    assert.is_not_nil(stage.current())

    neovim_pi.reset()

    assert.is_false(owned.has(buf))
    assert.is_nil(stage.current())
  end)

  it("is safe to call when nothing is claimed or watched", function()
    assert.has_no.errors(function()
      neovim_pi.reset()
    end)
  end)
end)
