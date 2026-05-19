-- commands.lua has a module-local `registered` flag and no
-- public disable hook. Reload the module per test so we can
-- exercise enable() from a clean state.
local commands, rpc, handshake

local function fresh_modules()
  for name in pairs(package.loaded) do
    if name:match("^neovim%-pi") then
      package.loaded[name] = nil
    end
  end
  commands = require("neovim-pi.commands")
  rpc = require("neovim-pi.rpc")
  handshake = require("neovim-pi.handshake")
end

--- Capture vim.notify output for the duration of `block`.
local function with_captured_notify(block)
  local captured = {}
  local original = vim.notify
  vim.notify = function(msg, level, _opts)
    table.insert(captured, { msg = msg, level = level })
  end
  local ok, err = pcall(block, captured)
  vim.notify = original
  if not ok then
    error(err)
  end
  return captured
end

describe("neovim-pi.commands", function()
  before_each(function()
    pcall(vim.api.nvim_del_user_command, "PiStatus")
    pcall(vim.api.nvim_del_user_command, "PiDetach")
    fresh_modules()
    rpc.clear_channel()
  end)

  describe("enable()", function()
    it("registers :PiStatus and :PiDetach", function()
      commands.enable()
      local cmds = vim.api.nvim_get_commands({})
      assert.is_table(cmds.PiStatus)
      assert.is_table(cmds.PiDetach)
    end)

    it("is idempotent on repeat calls", function()
      commands.enable()
      assert.has_no.errors(function()
        commands.enable()
      end)
    end)
  end)

  describe(":PiStatus", function()
    it("reports 'not attached' when no peer has been recorded", function()
      commands.enable()
      local notes = with_captured_notify(function()
        vim.cmd("PiStatus")
      end)
      assert.is_truthy(notes[1].msg:match("not attached"))
    end)

    it("reports peer version and capability count when attached", function()
      commands.enable()
      handshake.exchange("9.9.9", { "pi.session.get", "pi.tool.list", "pi.prompt.append" }, 12)
      local notes = with_captured_notify(function()
        vim.cmd("PiStatus")
      end)
      local msg = notes[1].msg
      assert.is_truthy(msg:match("attached"))
      assert.is_truthy(msg:match("v9%.9%.9"))
      assert.is_truthy(msg:match("3 caps"))
    end)
  end)

  describe(":PiDetach", function()
    it("clears the RPC channel so is_attached returns false", function()
      commands.enable()
      rpc.set_channel(33)
      assert.is_true(rpc.is_attached())
      with_captured_notify(function()
        vim.cmd("PiDetach")
      end)
      assert.is_false(rpc.is_attached())
    end)

    it("notifies the user that detachment happened", function()
      commands.enable()
      rpc.set_channel(33)
      local notes = with_captured_notify(function()
        vim.cmd("PiDetach")
      end)
      assert.is_truthy(notes[1].msg:match("detached"))
    end)
  end)
end)
