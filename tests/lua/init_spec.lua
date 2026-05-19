-- `setup()` resets to documented defaults each call, so a
-- simple state reset is enough between tests.
local neovim_pi = require("neovim-pi")

local function reset()
  require("neovim-pi.buffer").disable()
  require("neovim-pi.commands").disable()
  require("neovim-pi.rpc").clear_channel()
end

describe("neovim-pi (top level)", function()
  before_each(reset)
  after_each(reset)

  describe("setup()", function()
    it("chooses a per-pid socket path under the pi state dir by default", function()
      local tmp = vim.fn.tempname()
      vim.fn.mkdir(tmp, "p")
      local saved = vim.env.XDG_RUNTIME_DIR
      vim.env.XDG_RUNTIME_DIR = tmp

      neovim_pi.setup({})
      local cfg = neovim_pi.config()
      assert.is_string(cfg.listen)
      assert.is_truthy(cfg.listen:match("nvim%-%d+%.sock$"))
      assert.is_truthy(cfg.listen:find(tmp, 1, true))

      -- Ensure the socket was actually created on disk.
      assert.is_truthy(vim.uv.fs_stat(cfg.listen))

      pcall(vim.fn.serverstop, cfg.listen)
      pcall(os.remove, cfg.listen)
      pcall(vim.fn.delete, tmp, "rf")
      vim.env.XDG_RUNTIME_DIR = saved
    end)

    it("honours an explicit listen path", function()
      local tmp = vim.fn.tempname()
      local path = tmp .. "/explicit.sock"
      vim.fn.mkdir(tmp, "p")

      neovim_pi.setup({ listen = path })
      assert.are.equal(path, neovim_pi.config().listen)
      assert.is_truthy(vim.uv.fs_stat(path))

      pcall(vim.fn.serverstop, path)
      pcall(os.remove, path)
      pcall(vim.fn.delete, tmp, "rf")
    end)

    it("enables the BufReadCmd adapter when buffers.enable = true", function()
      local tmp = vim.fn.tempname() .. ".sock"
      neovim_pi.setup({ listen = tmp, buffers = { enable = true } })
      local for_pi = vim.tbl_filter(function(ac)
        return ac.pattern == "pi://*" and ac.group_name == "neovim-pi-buffer"
      end, vim.api.nvim_get_autocmds({ event = "BufReadCmd" }))
      assert.are.equal(1, #for_pi)
      pcall(vim.fn.serverstop, tmp)
      pcall(os.remove, tmp)
    end)

    it("leaves the BufReadCmd adapter off by default", function()
      local tmp = vim.fn.tempname() .. ".sock"
      neovim_pi.setup({ listen = tmp })
      local for_pi = vim.tbl_filter(function(ac)
        return ac.pattern == "pi://*" and ac.group_name == "neovim-pi-buffer"
      end, vim.api.nvim_get_autocmds({ event = "BufReadCmd" }))
      assert.are.equal(0, #for_pi)
      pcall(vim.fn.serverstop, tmp)
      pcall(os.remove, tmp)
    end)

    it("enables user commands when commands.enable = true", function()
      local tmp = vim.fn.tempname() .. ".sock"
      neovim_pi.setup({ listen = tmp, commands = { enable = true } })
      local cmds = vim.api.nvim_get_commands({})
      assert.is_table(cmds.PiStatus)
      assert.is_table(cmds.PiDetach)
      pcall(vim.fn.serverstop, tmp)
      pcall(os.remove, tmp)
    end)

    it("leaves user commands off by default", function()
      local tmp = vim.fn.tempname() .. ".sock"
      neovim_pi.setup({ listen = tmp })
      local cmds = vim.api.nvim_get_commands({})
      assert.is_nil(cmds.PiStatus)
      assert.is_nil(cmds.PiDetach)
      pcall(vim.fn.serverstop, tmp)
      pcall(os.remove, tmp)
    end)

    it("each call resets options to defaults", function()
      -- Documents the contract that `setup()` is not a deep
      -- merge across calls: turning something on then calling
      -- setup() again without it turns it back off.
      local tmp = vim.fn.tempname() .. ".sock"
      neovim_pi.setup({
        listen = tmp,
        buffers = { enable = true },
        commands = { enable = true },
      })
      assert.is_table(vim.api.nvim_get_commands({}).PiStatus)

      neovim_pi.setup({ listen = tmp })
      local cmds = vim.api.nvim_get_commands({})
      assert.is_nil(cmds.PiStatus)
      local for_pi = vim.tbl_filter(function(ac)
        return ac.pattern == "pi://*" and ac.group_name == "neovim-pi-buffer"
      end, vim.api.nvim_get_autocmds({ event = "BufReadCmd" }))
      assert.are.equal(0, #for_pi)
      pcall(vim.fn.serverstop, tmp)
      pcall(os.remove, tmp)
    end)
  end)

  describe("is_attached()", function()
    it("reflects the RPC channel state", function()
      local rpc = require("neovim-pi.rpc")
      assert.is_false(neovim_pi.is_attached())
      rpc.set_channel(7)
      assert.is_true(neovim_pi.is_attached())
      rpc.clear_channel()
      assert.is_false(neovim_pi.is_attached())
    end)
  end)
end)
