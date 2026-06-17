local file = require("neovim-pi.file")
local text = require("neovim-pi.text")
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
end

describe("neovim-pi.file", function()
  before_each(reset_layout)

  describe("open()", function()
    it("loads the file contents into a buffer", function()
      local path = temp_file({ "line one", "line two", "line three" })
      local result = file.open(path)

      assert.is_number(result.bufnr)
      assert.is_true(vim.api.nvim_buf_is_loaded(result.bufnr))
      assert.are.same(
        { "line one", "line two", "line three" },
        vim.api.nvim_buf_get_lines(result.bufnr, 0, -1, false)
      )
      assert.are.equal(3, result.lines)
    end)

    it("reports the absolute path", function()
      local path = temp_file({ "x" })
      local result = file.open(path)
      assert.are.equal(vim.fn.fnamemodify(path, ":p"), result.path)
    end)

    it("shows the file on the stage window without stealing focus", function()
      local human = vim.api.nvim_get_current_win()
      local path = temp_file({ "a", "b" })
      local result = file.open(path)

      assert.are.equal(result.bufnr, vim.api.nvim_win_get_buf(stage.current()))
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)

    it("claims the buffer in the ownership ledger", function()
      local path = temp_file({ "owned?" })
      local result = file.open(path)
      assert.is_true(owned.has(result.bufnr))
    end)

    it("refuses to adopt a buffer the human has open with unsaved changes", function()
      local path = temp_file({ "original" })
      local human_buf = vim.fn.bufadd(path)
      vim.fn.bufload(human_buf)
      vim.api.nvim_buf_set_lines(human_buf, 0, -1, false, { "edited by human" })
      assert.is_true(vim.bo[human_buf].modified)

      assert.has_error(function()
        file.open(path)
      end)
      assert.is_false(owned.has(human_buf))
    end)

    it("reopens a dirty buffer pi already owns without error", function()
      local path = temp_file({ "original" })
      local first = file.open(path)
      text.set_range(first.bufnr, 1, 0, 1, 8, "changed")
      assert.is_true(vim.bo[first.bufnr].modified)

      local again = file.open(path)
      assert.are.equal(first.bufnr, again.bufnr)
    end)
  end)

  describe("save()", function()
    it("writes an edited buffer to disk and clears the dirty flag", function()
      local path = temp_file({ "hello" })
      local opened = file.open(path)
      text.set_range(opened.bufnr, 1, 0, 1, 5, "HELLO")
      assert.is_true(vim.bo[opened.bufnr].modified)

      local result = file.save(opened.bufnr)
      assert.is_true(result.ok)
      assert.is_false(result.modified)
      assert.are.same({ "HELLO" }, vim.fn.readfile(path))
    end)

    it("refuses to save a buffer pi does not own", function()
      local bufnr = vim.api.nvim_create_buf(false, true)
      local result = file.save(bufnr)
      assert.is_false(result.ok)
    end)
  end)
end)
