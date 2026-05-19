local commands = require("neovim-pi.commands")
local rpc = require("neovim-pi.rpc")
local handshake = require("neovim-pi.handshake")

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
    commands.disable()
    rpc.clear_channel()
  end)

  after_each(function()
    commands.disable()
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

  describe("disable()", function()
    it("unregisters both commands", function()
      commands.enable()
      commands.disable()
      local cmds = vim.api.nvim_get_commands({})
      assert.is_nil(cmds.PiStatus)
      assert.is_nil(cmds.PiDetach)
    end)

    it("is safe to call when not enabled", function()
      assert.has_no.errors(function()
        commands.disable()
      end)
    end)

    it("re-enable after disable registers fresh commands", function()
      commands.enable()
      commands.disable()
      commands.enable()
      assert.is_table(vim.api.nvim_get_commands({}).PiStatus)
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
