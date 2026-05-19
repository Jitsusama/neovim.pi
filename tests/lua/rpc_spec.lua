local rpc = require("neovim-pi.rpc")

describe("neovim-pi.rpc", function()
  describe("attachment state", function()
    it("starts unattached", function()
      rpc.clear_channel()
      assert.is_false(rpc.is_attached())
    end)

    it("flips to attached after set_channel", function()
      rpc.set_channel(42)
      assert.is_true(rpc.is_attached())
      rpc.clear_channel()
    end)

    it("clear_channel is idempotent", function()
      rpc.clear_channel()
      rpc.clear_channel()
      assert.is_false(rpc.is_attached())
    end)
  end)

  describe("call() without a peer", function()
    before_each(function()
      rpc.clear_channel()
    end)

    it("invokes the callback with an error message", function()
      local got_err, got_result
      rpc.call("anything", {}, function(err, result)
        got_err = err
        got_result = result
      end)
      assert.is_string(got_err)
      assert.is_nil(got_result)
    end)

    it("does not throw when no callback is supplied", function()
      assert.has_no.errors(function()
        rpc.call("anything", {}, nil)
      end)
    end)
  end)

  describe("listen()", function()
    local tmp_dir
    local socket_path

    before_each(function()
      tmp_dir = vim.fn.tempname()
      vim.fn.mkdir(tmp_dir, "p")
      socket_path = tmp_dir .. "/test.sock"
    end)

    after_each(function()
      pcall(vim.fn.serverstop, socket_path)
      pcall(os.remove, socket_path)
      pcall(vim.fn.delete, tmp_dir, "rf")
    end)

    it("creates the parent directory if missing", function()
      local nested = tmp_dir .. "/nested/deep/test.sock"
      rpc.listen(nested)
      assert.is_truthy(vim.uv.fs_stat(nested))
      pcall(vim.fn.serverstop, nested)
      pcall(os.remove, nested)
    end)

    it("removes a stale socket file before starting", function()
      -- Pretend a previous nvim left a file at this path.
      local f = io.open(socket_path, "w")
      assert.is_not_nil(f);
      (f --[[@as file*]]):write("stale");
      (f --[[@as file*]]):close()

      rpc.listen(socket_path)
      local stat = vim.uv.fs_stat(socket_path)
      assert.is_truthy(stat)
      -- After our listen() the path should be a socket, not a regular file.
      assert.are.equal("socket", stat.type)
    end)

    it("writes a .cwd sidecar so pi's picker can show project context", function()
      rpc.listen(socket_path)
      local sidecar = socket_path:gsub("%.sock$", ".cwd")
      local f = io.open(sidecar, "r")
      assert.is_not_nil(f)
      local body = (f --[[@as file*]]):read("*a");
      (f --[[@as file*]]):close()
      assert.are.equal(vim.fn.getcwd(), body)
      pcall(os.remove, sidecar)
    end)

    it("refreshes the sidecar when the user changes cwd", function()
      rpc.listen(socket_path)
      local sidecar = socket_path:gsub("%.sock$", ".cwd")
      local elsewhere = vim.fn.tempname()
      vim.fn.mkdir(elsewhere, "p")
      local prev = vim.fn.getcwd()
      vim.cmd("cd " .. elsewhere)
      -- DirChanged should have fired and rewritten the sidecar.
      local f = io.open(sidecar, "r")
      assert.is_not_nil(f)
      local body = (f --[[@as file*]]):read("*a");
      (f --[[@as file*]]):close()
      assert.are.equal(vim.fn.getcwd(), body)
      vim.cmd("cd " .. prev)
      pcall(os.remove, sidecar)
      pcall(vim.fn.delete, elsewhere, "rf")
    end)
  end)
end)
