local lsp = require("neovim-pi.lsp")
local helpers = lsp.__test

--- Write lines to a temp file and return its path, so the
--- normalizers that read a file's bytes have real content.
local function tempfile(lines)
  local path = vim.fn.tempname() .. ".ts"
  vim.fn.writefile(lines, path)
  return path
end

describe("neovim-pi.lsp coordinate conversion", function()
  -- "café x": é is two UTF-8 bytes but one UTF-16 unit, so
  -- the byte column and the UTF-16 column diverge after it.
  local line = "café x"

  it("converts a byte column to a UTF-16 column", function()
    -- "x" sits at byte 6 and UTF-16 unit 5.
    assert.are.equal(5, helpers.byte_to_unit(line, 6, "utf-16"))
  end)

  it("converts a UTF-16 column back to a byte column", function()
    assert.are.equal(6, helpers.unit_to_byte(line, 5, "utf-16"))
  end)

  it("is an identity for utf-8", function()
    assert.are.equal(4, helpers.byte_to_unit(line, 4, "utf-8"))
    assert.are.equal(4, helpers.unit_to_byte(line, 4, "utf-8"))
  end)

  it("clamps a byte column past the line end", function()
    assert.are.equal(6, helpers.byte_to_unit(line, 999, "utf-16"))
  end)
end)

describe("neovim-pi.lsp symbol flattening", function()
  it("flattens a documentSymbol tree with containers and 1-indexes lines", function()
    local path = tempfile({ "class Foo {", "  bar() {}", "}" })
    local out = {}
    helpers.flatten_symbols({
      {
        name = "Foo",
        kind = 5, -- class
        selectionRange = {
          start = { line = 0, character = 6 },
          ["end"] = { line = 0, character = 9 },
        },
        children = {
          {
            name = "bar",
            kind = 6, -- method
            selectionRange = {
              start = { line = 1, character = 2 },
              ["end"] = { line = 1, character = 5 },
            },
          },
        },
      },
    }, path, "utf-16", nil, out)

    assert.are.equal(2, #out)
    assert.are.equal("Foo", out[1].name)
    assert.are.equal("class", out[1].kind)
    assert.are.equal(1, out[1].location.range.start.line) -- 0 -> 1 indexed
    assert.are.equal("bar", out[2].name)
    assert.are.equal("method", out[2].kind)
    assert.are.equal("Foo", out[2].containerName)
    assert.are.equal(2, out[2].location.range.start.line)
  end)

  it("flattens symbolInformation entries by their own location", function()
    local path = tempfile({ "const answer = 42" })
    local out = {}
    helpers.flatten_symbols({
      {
        name = "answer",
        kind = 14, -- constant
        location = {
          uri = vim.uri_from_fname(path),
          range = {
            start = { line = 0, character = 6 },
            ["end"] = { line = 0, character = 12 },
          },
        },
        containerName = "globals",
      },
    }, path, "utf-16", nil, out)

    assert.are.equal("answer", out[1].name)
    assert.are.equal("constant", out[1].kind)
    assert.are.equal("globals", out[1].containerName)
    assert.are.equal(path, out[1].location.path)
  end)
end)

describe("neovim-pi.lsp workspace edit normalization", function()
  it("normalizes the documentChanges form", function()
    local path = tempfile({ "let old = 1", "old = old + 1" })
    local changes = helpers.normalize_workspace_edit({
      documentChanges = {
        {
          textDocument = { uri = vim.uri_from_fname(path) },
          edits = {
            {
              range = {
                start = { line = 0, character = 4 },
                ["end"] = { line = 0, character = 7 },
              },
              newText = "renamed",
            },
          },
        },
      },
    }, "utf-16")

    assert.are.equal(1, #changes)
    assert.are.equal(path, changes[1].path)
    assert.are.equal("renamed", changes[1].edits[1].newText)
    assert.are.equal(1, changes[1].edits[1].range.start.line)
    assert.are.equal(4, changes[1].edits[1].range.start.character)
  end)

  it("normalizes the changes-map form", function()
    local path = tempfile({ "value" })
    local changes = helpers.normalize_workspace_edit({
      changes = {
        [vim.uri_from_fname(path)] = {
          {
            range = {
              start = { line = 0, character = 0 },
              ["end"] = { line = 0, character = 5 },
            },
            newText = "renamed",
          },
        },
      },
    }, "utf-16")

    assert.are.equal(path, changes[1].path)
    assert.are.equal("renamed", changes[1].edits[1].newText)
  end)
end)

describe("neovim-pi.lsp symbol kinds", function()
  it("maps the LSP SymbolKind integers to readable names", function()
    assert.are.equal("class", helpers.SYMBOL_KIND[5])
    assert.are.equal("function", helpers.SYMBOL_KIND[12])
    assert.are.equal("type-parameter", helpers.SYMBOL_KIND[26])
  end)
end)
