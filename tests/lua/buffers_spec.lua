local buffers = require("neovim-pi.buffers")
local owned = require("neovim-pi.owned")

--- Entry for a bufnr in a list() result.
local function entry_for(list, bufnr)
  for _, b in ipairs(list) do
    if b.bufnr == bufnr then
      return b
    end
  end
end

describe("neovim-pi.buffers", function()
  before_each(function()
    owned.clear()
  end)

  describe("list()", function()
    it("includes a loaded buffer with its name and flags", function()
      local bufnr = vim.api.nvim_create_buf(true, false)
      vim.api.nvim_buf_set_name(bufnr, "/tmp/listed-buffer")
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "changed" })

      local entry = entry_for(buffers.list(), bufnr)
      assert.is_not_nil(entry)
      assert.is_true(entry.name:match("listed%-buffer") ~= nil)
      assert.is_true(entry.listed)
      assert.is_true(entry.loaded)
      assert.is_true(entry.modified)
    end)

    it("marks buffers pi owns", function()
      local mine = vim.api.nvim_create_buf(true, false)
      local theirs = vim.api.nvim_create_buf(true, false)
      owned.claim(mine)

      local list = buffers.list()
      assert.is_true(entry_for(list, mine).owned)
      assert.is_false(entry_for(list, theirs).owned)
    end)
  end)
end)
