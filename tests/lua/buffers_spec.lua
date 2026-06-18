local buffers = require("neovim-pi.buffers")
local owned = require("neovim-pi.owned")
local stage = require("neovim-pi.stage")

--- Entry for a bufnr in a list() result.
local function entry_for(list, bufnr)
  for _, b in ipairs(list) do
    if b.bufnr == bufnr then
      return b
    end
  end
end

--- Drop pi's claims and collapse to a single window.
local function reset()
  owned.clear()
  stage.forget()
  local wins = vim.api.nvim_list_wins()
  for i = 2, #wins do
    pcall(vim.api.nvim_win_close, wins[i], true)
  end
end

describe("neovim-pi.buffers", function()
  before_each(reset)

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

  describe("switch()", function()
    it("shows an existing buffer on pi's stage window without stealing focus", function()
      local human = vim.api.nvim_get_current_win()
      local bufnr = vim.api.nvim_create_buf(true, false)

      local result = buffers.switch(bufnr)

      assert.is_true(result.ok)
      assert.are.equal(stage.current(), result.win)
      assert.are.equal(bufnr, vim.api.nvim_win_get_buf(result.win))
      assert.are.equal(human, vim.api.nvim_get_current_win())
    end)

    it("refuses an invalid buffer handle", function()
      local result = buffers.switch(999999)
      assert.is_false(result.ok)
    end)
  end)

  describe("delete()", function()
    it("deletes a buffer pi owns and releases the claim", function()
      local bufnr = vim.api.nvim_create_buf(true, false)
      owned.claim(bufnr)

      local result = buffers.delete(bufnr)

      assert.is_true(result.ok)
      assert.is_false(vim.api.nvim_buf_is_valid(bufnr))
      assert.is_false(owned.has(bufnr))
    end)

    it("refuses a buffer pi does not own", function()
      local bufnr = vim.api.nvim_create_buf(true, false)
      local result = buffers.delete(bufnr)
      assert.is_false(result.ok)
      assert.is_true(vim.api.nvim_buf_is_valid(bufnr))
    end)

    it("refuses a modified buffer until forced", function()
      local bufnr = vim.api.nvim_create_buf(true, false)
      owned.claim(bufnr)
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "unsaved work" })

      local refused = buffers.delete(bufnr)
      assert.is_false(refused.ok)
      assert.is_true(refused.modified)
      assert.is_true(vim.api.nvim_buf_is_valid(bufnr))

      local forced = buffers.delete(bufnr, true)
      assert.is_true(forced.ok)
      assert.is_false(vim.api.nvim_buf_is_valid(bufnr))
    end)
  end)

  describe("info()", function()
    it("reports detailed state for a buffer", function()
      local bufnr = vim.api.nvim_create_buf(true, false)
      vim.api.nvim_buf_set_name(bufnr, "/tmp/info-buffer")
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "one", "two" })
      owned.claim(bufnr)

      local result = buffers.info(bufnr)

      assert.is_true(result.ok)
      assert.are.equal(bufnr, result.bufnr)
      assert.is_true(result.name:match("info%-buffer") ~= nil)
      assert.is_true(result.loaded)
      assert.is_true(result.modified)
      assert.is_true(result.owned)
      assert.are.equal(2, result.lines)
      assert.is_not_nil(result.changedtick)
    end)

    it("refuses an invalid buffer handle", function()
      local result = buffers.info(999999)
      assert.is_false(result.ok)
    end)
  end)
end)
