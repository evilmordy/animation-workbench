请按用户的修改要求，修改下面的分镜。

用户要求：
<instruction>
{{instruction}}
</instruction>

修改范围：{{scope}}
已锁定、绝对不能修改/删除/移动的场景：{{locked}}

当前内容（JSON）：
{{current}}

只输出操作列表 JSON，格式：
{"ops": [ 操作, ... ]}
可用的操作：
- {"op": "replaceScene", "id": 场景id, "scene": 完整的新场景对象}
- {"op": "insertScene", "after": 场景id 或 null（插到最前）, "scene": 完整的新场景对象}
- {"op": "deleteScene", "id": 场景id}
- {"op": "moveScene", "id": 场景id, "after": 场景id 或 null}

要求：
- 只改用户要求改的部分，其他内容保持原样（替换场景时要输出完整场景，未改动的元素和步骤原样保留）。
- 修改范围之外的场景不要动。
- 改完的场景仍要满足全部规则，尤其是元素的出场/离场顺序和引用。
- 新插入的场景使用新的、不重复的 id。
