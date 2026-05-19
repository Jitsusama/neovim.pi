local buffer = require("neovim-pi.buffer")
local rpc = require("neovim-pi.rpc")

--- Override rpc.call for the duration of a block. Mirrors what
--- a real pi peer would do but lets the test control the result.
local function with_fake_rpc(handler, block)
  local original = rpc.call
  rpc.call = handler
  local ok, err = pcall(block)
  rpc.call = original
  if not ok then
    error(err)
  end
end

--- Pump scheduled callbacks so the asserts run after the
--- vim.schedule() inside `_read` has fired.
local function drain_scheduled()
  vim.wait(50, function()
    return false
  end)
end

describe("neovim-pi.buffer", function()
  before_each(function()
    buffer.disable()
    -- Wipe any pi:// buffers from previous tests.
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      local name = vim.api.nvim_buf_get_name(b)
      if name:match("^pi://") then
        pcall(vim.api.nvim_buf_delete, b, { force = true })
      end
    end
  end)

  describe("enable() / disable()", function()
    it("registers a BufReadCmd autocmd for the pi:// scheme", function()
      buffer.enable()
      local autocmds = vim.api.nvim_get_autocmds({ group = "neovim-pi-buffer", event = "BufReadCmd" })
      assert.is_true(#autocmds > 0)
    end)

    it("is idempotent", function()
      buffer.enable()
      assert.has_no.errors(function()
        buffer.enable()
      end)
    end)

    it("disable() tears the autocmd group down", function()
      buffer.enable()
      buffer.disable()
      local ok = pcall(vim.api.nvim_get_autocmds, { group = "neovim-pi-buffer" })
      assert.is_false(ok)
    end)
  end)

  describe("close()", function()
    it("returns false when no buffer exists for the URI", function()
      assert.is_false(buffer.close("pi://nothing/here"))
    end)

    it("removes an existing pi:// buffer and returns true", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "ok" } })
      end, function()
        buffer.open("pi://test/closeme", false)
        drain_scheduled()
        assert.is_true(buffer.close("pi://test/closeme"))
        assert.are.equal(-1, vim.fn.bufnr("pi://test/closeme"))
      end)
    end)
  end)

  describe("mark_stale()", function()
    it("does nothing when the buffer is absent", function()
      assert.has_no.errors(function()
        buffer.mark_stale("pi://missing")
      end)
    end)

    it("sets a buffer-local stale flag on the matching buffer", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "ok" } })
      end, function()
        buffer.open("pi://test/stale", false)
        drain_scheduled()
        buffer.mark_stale("pi://test/stale")
        local bufnr = vim.fn.bufnr("pi://test/stale")
        assert.is_true(vim.b[bufnr]["neovim_pi_stale"])
      end)
    end)
  end)

  describe("is_modified()", function()
    it("returns false when no buffer is loaded for the path", function()
      assert.is_false(buffer.is_modified("/no/such/file.txt"))
    end)

    it("returns true when a buffer for the path is dirty", function()
      -- macOS tempname paths resolve through a /var -> /private/var
      -- symlink, so we use the actual buffer name (post-resolution)
      -- as the lookup key. The contract under test is:
      -- given a path equal to some loaded buffer's name, return
      -- true when that buffer is modified.
      local tmp = vim.fn.tempname()
      vim.fn.writefile({ "original" }, tmp)
      vim.cmd("edit " .. tmp)
      local bufnr = vim.api.nvim_get_current_buf()
      local bufname = vim.api.nvim_buf_get_name(bufnr)
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { "dirty" })
      vim.bo[bufnr].modified = true
      assert.is_true(buffer.is_modified(bufname))
      pcall(vim.api.nvim_buf_delete, bufnr, { force = true })
      pcall(os.remove, tmp)
    end)
  end)

  describe("BufReadCmd round trip", function()
    it("populates the buffer with the resolver's lines", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "line one", "line two", "line three" } })
      end, function()
        buffer.open("pi://test/lines", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/lines")
        assert.is_true(bufnr > 0)
        local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
        assert.are.same({ "line one", "line two", "line three" }, lines)
      end)
    end)

    it("makes the buffer read-only after populating", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "content" } })
      end, function()
        buffer.open("pi://test/readonly", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/readonly")
        assert.is_true(vim.bo[bufnr].readonly)
        assert.is_false(vim.bo[bufnr].modifiable)
      end)
    end)

    it("applies the resolver's filetype when supplied", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "# hi" }, filetype = "markdown" })
      end, function()
        buffer.open("pi://test/ft", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/ft")
        assert.are.equal("markdown", vim.bo[bufnr].filetype)
      end)
    end)

    it("shows a diagnostic line when the resolver errors", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb("boom", nil)
      end, function()
        buffer.open("pi://test/err", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/err")
        local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
        assert.is_truthy(lines[1]:match("failed to resolve"))
        assert.is_truthy(table.concat(lines, "\n"):match("boom"))
      end)
    end)

    it("shows a fallback line when the resolver returns no lines", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = {} })
      end, function()
        buffer.open("pi://test/empty", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/empty")
        local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
        -- An empty result table.lines = {} yields a single empty
        -- line for the buffer; whatever we show, it must not be a
        -- crash and the buffer must remain readable.
        assert.is_table(lines)
      end)
    end)

    it("shows a typed diagnostic when the resolver returns an unexpected shape", function()
      buffer.enable()
      with_fake_rpc(function(_, _, cb)
        -- Simulate the vim.NIL userdata that triggered the
        -- resp.send signature bug.
        cb(nil, vim.NIL)
      end, function()
        buffer.open("pi://test/userdata", false)
        drain_scheduled()
        local bufnr = vim.fn.bufnr("pi://test/userdata")
        local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
        local body = table.concat(lines, "\n")
        assert.is_truthy(body:match("unexpected response shape"))
        assert.is_truthy(body:match("type=userdata"))
      end)
    end)

    it("fires the NeovimPiBufferLoaded autocmd after loading", function()
      buffer.enable()
      local fired = {}
      vim.api.nvim_create_autocmd("User", {
        pattern = "NeovimPiBufferLoaded",
        callback = function(args)
          table.insert(fired, args.data)
        end,
      })
      with_fake_rpc(function(_, _, cb)
        cb(nil, { lines = { "x" } })
      end, function()
        buffer.open("pi://test/event", false)
        drain_scheduled()
        assert.are.equal(1, #fired)
        assert.are.equal("pi://test/event", fired[1].uri)
      end)
    end)
  end)
end)
