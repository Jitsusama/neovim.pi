local diff = require("neovim-pi.diff")
local file = require("neovim-pi.file")
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

  describe("pending()", function()
    it("diffs the on-disk bytes against the buffer's unsaved edits", function()
      local human = vim.api.nvim_get_current_win()
      local path = temp_file({ "disk one", "disk two" })
      local opened = file.open(path)
      vim.api.nvim_buf_set_lines(opened.bufnr, 0, -1, false, { "disk one", "EDITED two" })

      local result = diff.pending(opened.bufnr)

      assert.is_true(result.ok)
      assert.is_true(vim.wo[result.original.win].diff)
      assert.is_true(vim.wo[result.pending.win].diff)
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)

    it("holds the on-disk content on the original side, the edits on the pending side", function()
      local path = temp_file({ "disk" })
      local opened = file.open(path)
      vim.api.nvim_buf_set_lines(opened.bufnr, 0, -1, false, { "edited" })

      local result = diff.pending(opened.bufnr)

      assert.are.same({ "disk" }, vim.api.nvim_buf_get_lines(result.original.bufnr, 0, -1, false))
      assert.are.same({ "edited" }, vim.api.nvim_buf_get_lines(result.pending.bufnr, 0, -1, false))
      assert.are.equal(opened.bufnr, result.pending.bufnr)
    end)

    it("refuses a buffer pi does not own", function()
      local stray = vim.api.nvim_create_buf(true, false)

      local result = diff.pending(stray)

      assert.is_false(result.ok)
    end)

    it("refuses an owned buffer with no file on disk", function()
      local scratch = vim.api.nvim_create_buf(false, true)
      owned.claim(scratch)

      local result = diff.pending(scratch)

      assert.is_false(result.ok)
    end)
  end)
end)
