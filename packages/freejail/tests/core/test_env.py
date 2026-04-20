import pytest
from freejail.core.env import capture_env_vars, validate_env_vars

PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_"]


def test_captures_anthropic_vars():
    env = {
        "ANTHROPIC_API_KEY": "sk-abc",
        "ANTHROPIC_MODEL": "claude-opus-4-6",
        "HOME": "/home/user",
        "PATH": "/usr/bin",
    }
    result = capture_env_vars(env, PREFIXES)
    assert result == {
        "ANTHROPIC_API_KEY": "sk-abc",
        "ANTHROPIC_MODEL": "claude-opus-4-6",
    }


def test_captures_claude_code_vars():
    env = {
        "CLAUDE_CODE_MAX_TOKENS": "4096",
        "CLAUDE_API_KEY": "should-not-match",
    }
    result = capture_env_vars(env, PREFIXES)
    assert result == {"CLAUDE_CODE_MAX_TOKENS": "4096"}


def test_captures_both_prefixes():
    env = {
        "ANTHROPIC_API_KEY": "sk-abc",
        "CLAUDE_CODE_SETTING": "val",
        "OTHER": "ignored",
    }
    result = capture_env_vars(env, PREFIXES)
    assert len(result) == 2


def test_empty_env():
    assert capture_env_vars({}, PREFIXES) == {}


def test_custom_prefixes():
    env = {"CUSTOM_FOO": "bar", "ANTHROPIC_KEY": "val"}
    result = capture_env_vars(env, ["CUSTOM_"])
    assert result == {"CUSTOM_FOO": "bar"}


def test_validate_env_vars_accepts_clean():
    validate_env_vars({"FOO": "bar", "BAZ": "qux=1"})
    validate_env_vars({})


@pytest.mark.parametrize(
    "bad",
    [
        {"FOO\n": "val"},
        {"FOO\r": "val"},
        {"FOO\x00": "val"},
    ],
)
def test_validate_env_vars_rejects_unsafe_keys(bad):
    with pytest.raises(ValueError, match="name contains unsafe"):
        validate_env_vars(bad)


@pytest.mark.parametrize(
    "bad_value",
    ["val\nue", "val\rue", "val\x00ue"],
)
def test_validate_env_vars_rejects_unsafe_values(bad_value):
    with pytest.raises(ValueError, match="value contains unsafe"):
        validate_env_vars({"KEY": bad_value})


def test_validate_env_vars_allows_equals_and_spaces_in_values():
    validate_env_vars({"CMD": "echo hello world", "URL": "http://a.b/c?x=1&y=2"})
