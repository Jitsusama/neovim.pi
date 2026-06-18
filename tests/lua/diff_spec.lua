local diff = require("neovim-pi.diff")
local stage = require("neovim-pi.stage")
local owned = require("neovim-pi.owned")

--- Write known content to a throwaway file and return its path.
local function temp_file(lines)
  local path = vim.fn.tempname()
  vim.fn.writefile(lines, path)
  return path
end

local function reset_layout()
  stage.forget()
  owned.clear()
  local wins = vim.api.nvim_list_wins()
  for i = 2, #wins do
    pcall(vim.api.nvim_win_close, wins[i], true)
  end
  -- diff mode can linger on the surviving window between tests.
  pcall(vim.cmd, "diffoff!")
end

describe("neovim-pi.diff", function()
  before_each(reset_layout)

  describe("files()", function()
    it("shows both files side by side in diff mode without stealing focus", function()
      local human = vim.api.nvim_get_current_win()
      local left = temp_file({ "alpha", "beta", "gamma" })
      local right = temp_file({ "alpha", "BETA", "gamma" })

      local result = diff.files(left, right)

      assert.is_true(vim.wo[result.left.win].diff)
      assert.is_true(vim.wo[result.right.win].diff)
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)

    it("loads each file into its own buffer", function()
      local left = temp_file({ "left only" })
      local right = temp_file({ "right only" })

      local result = diff.files(left, right)

      assert.are.same({ "left only" }, vim.api.nvim_buf_get_lines(result.left.bufnr, 0, -1, false))
      assert.are.same(
        { "right only" },
        vim.api.nvim_buf_get_lines(result.right.bufnr, 0, -1, false)
      )
      assert.are_not.equal(result.left.bufnr, result.right.bufnr)
    end)

    it("opens both windows on pi's stage", function()
      local result = diff.files(temp_file({ "a" }), temp_file({ "b" }))

      assert.is_true(stage.owns(result.left.win))
      assert.is_true(stage.owns(result.right.win))
    end)
  end)

  describe("off()", function()
    it("turns diff mode back off in a pi-owned window", function()
      local result = diff.files(temp_file({ "a" }), temp_file({ "b" }))

      local r = diff.off(result.left.win)

      assert.is_true(r.ok)
      assert.is_false(vim.wo[result.left.win].diff)
    end)

    it("refuses a window pi does not own", function()
      local human = vim.api.nvim_get_current_win()

      local r = diff.off(human)

      assert.is_false(r.ok)
    end)
  end)
end)
