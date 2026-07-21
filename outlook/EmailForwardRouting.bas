Attribute VB_Name = "EmailForwardRouting"
' Contact form email routing — Outlook Classic VBA macros (L4).
'
' Install: Outlook → Alt+F11 → Insert → Module → paste this file
' Test first: run macro Routing_TestPing (should show a message box)

Option Explicit

' === CONFIGURATION ===
Private Const CLASSIFY_BAT As String = "C:\Tools\email-inbox-routing\scripts\classify-json.bat"
' =====================

' Step 0: run this first — if no message box appears, the macro is not wired correctly.
Public Sub Routing_TestPing()
    MsgBox "宏运行正常。" & vbCrLf & vbCrLf & _
           "BAT: " & CLASSIFY_BAT & vbCrLf & _
           "存在: " & IIf(Dir(CLASSIFY_BAT) <> "", "是", "否 — 请检查路径"), _
           vbInformation, "Email Routing Test"
End Sub

' Main: classify selected email and open a pre-filled forward draft.
Public Sub ClassifyAndForwardSelected()
    On Error GoTo ErrHandler

    Dim mail As Outlook.mailItem
    Set mail = GetSelectedMailItem()
    If mail Is Nothing Then Exit Sub

    Application.StatusBar = "Email Routing: 正在调用 AI 分类，请等待 30-60 秒…"
    DoEvents

    Dim result As Object
    Set result = ClassifyMailBody(mail.Body)
    Application.StatusBar = False

    If result Is Nothing Then
        MsgBox "分类未返回结果（内部错误）。", vbCritical, "Email Routing"
        Exit Sub
    End If

    If Not CBool(result("ok")) Then
        MsgBox "Classification failed: " & CStr(result("error")), vbExclamation, "Email Routing"
        Exit Sub
    End If

    Dim routing As Object
    Set routing = result("routing")

    Select Case CStr(routing("action"))
        Case "FORWARD"
            Dim fwd As Outlook.mailItem
            Set fwd = mail.Forward
            fwd.To = CStr(routing("outlookTo"))
            If Len(CStr(routing("outlookCc"))) > 0 Then
                fwd.CC = CStr(routing("outlookCc"))
            End If
            fwd.Display
            MsgBox BuildSummaryMessage(result), vbInformation, "Email Routing — Review & Send"

        Case "NO_FORWARD"
            MsgBox BuildNoForwardMessage(result), vbInformation, "Email Routing — No Forward"

        Case Else
            MsgBox BuildReviewMessage(result), vbExclamation, "Email Routing — Manual Review"
    End Select
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    MsgBox "宏运行出错: " & Err.Description & " (" & Err.Number & ")", vbCritical, "Email Routing"
End Sub

Public Sub ClassifySelected()
    On Error GoTo ErrHandler

    Dim mail As Outlook.mailItem
    Set mail = GetSelectedMailItem()
    If mail Is Nothing Then Exit Sub

    Application.StatusBar = "Email Routing: 正在调用 AI 分类，请等待 30-60 秒…"
    DoEvents

    Dim result As Object
    Set result = ClassifyMailBody(mail.Body)
    Application.StatusBar = False

    If result Is Nothing Then Exit Sub
    If Not CBool(result("ok")) Then
        MsgBox "Classification failed: " & CStr(result("error")), vbExclamation, "Email Routing"
        Exit Sub
    End If

    MsgBox BuildSummaryMessage(result), vbInformation, "Email Routing Result"
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    MsgBox "宏运行出错: " & Err.Description, vbCritical, "Email Routing"
End Sub

Private Function GetSelectedMailItem() As Outlook.mailItem
    On Error GoTo ErrHandler

    Dim exp As Outlook.Explorer
    Set exp = Application.ActiveExplorer
    If exp Is Nothing Then
        MsgBox "请先打开「邮件」文件夹（按 Ctrl+1）。", vbExclamation, "Email Routing"
        Exit Function
    End If

    Dim sel As Outlook.Selection
    Set sel = exp.Selection

    If sel.Count = 0 Then
        MsgBox "请先在左侧列表中点击选中一封邮件（仅阅读窗格打开不够）。", vbExclamation, "Email Routing"
        Exit Function
    End If
    If sel.Count > 1 Then
        MsgBox "请只选中一封邮件。", vbExclamation, "Email Routing"
        Exit Function
    End If
    If Not TypeOf sel.Item(1) Is Outlook.mailItem Then
        MsgBox "选中项不是邮件。", vbExclamation, "Email Routing"
        Exit Function
    End If

    Set GetSelectedMailItem = sel.Item(1)
    Exit Function

ErrHandler:
    MsgBox "无法读取选中邮件: " & Err.Description, vbCritical, "Email Routing"
End Function

Private Function ClassifyMailBody(body As String) As Object
    On Error GoTo ErrHandler

    Dim bodyFile As String
    Dim resultFile As String
    Dim shell As Object
    Dim exitCode As Long
    Dim stamp As String

    stamp = Format(Now, "yyyymmddhhnnss")
    bodyFile = Environ("TEMP") & "\ir-routing-body-" & stamp & ".txt"
    resultFile = Environ("TEMP") & "\ir-routing-result-" & stamp & ".json"

    If Dir(CLASSIFY_BAT) = "" Then
        MsgBox "找不到 classify-json.bat:" & vbCrLf & CLASSIFY_BAT, vbCritical, "Email Routing"
        Exit Function
    End If

    WriteUtf8 bodyFile, body

    Set shell = CreateObject("WScript.Shell")
    ' WindowStyle 1 = normal (visible) — easier to debug; change to 0 to hide later
    exitCode = shell.Run("""" & CLASSIFY_BAT & """ --body-file """ & bodyFile & """ --out """ & resultFile & """", 0, True)

    On Error Resume Next
    Kill bodyFile
    On Error GoTo ErrHandler

    If exitCode <> 0 Then
        MsgBox "classify-json 退出码 " & exitCode & "." & vbCrLf & vbCrLf & _
               "手动测试:" & vbCrLf & _
               "cd C:\Tools\email-inbox-routing" & vbCrLf & _
               "scripts\classify-json.bat --body-file fixtures\atra-media-inquiry.txt --out %TEMP%\t.json", _
               vbCritical, "Email Routing"
        Exit Function
    End If

    If Dir(resultFile) = "" Then
        MsgBox "未生成结果文件。请检查 Node.js 和 .env 配置。", vbCritical, "Email Routing"
        Exit Function
    End If

    Set ClassifyMailBody = ParseJsonFile(resultFile)

    On Error Resume Next
    Kill resultFile
    On Error GoTo 0
    Exit Function

ErrHandler:
    MsgBox "ClassifyMailBody 出错: " & Err.Description, vbCritical, "Email Routing"
End Function

Private Function BuildSummaryMessage(result As Object) As String
    Dim msg As String
    Dim decision As Object
    Dim routing As Object

    Set decision = result("decision")
    Set routing = result("routing")

    msg = "Submitter: " & CStr(result("submitterEmail")) & vbCrLf

    If CStr(decision("kind")) = "SingleCategory" Then
        msg = msg & "Category:  " & CStr(decision("category")) & vbCrLf
        msg = msg & "Score:     " & Format(CDbl(decision("score")), "0.00") & vbCrLf
    Else
        msg = msg & "Decision:  " & CStr(decision("kind")) & vbCrLf
    End If

    msg = msg & vbCrLf & "Action:    " & CStr(routing("action"))

    If CStr(routing("action")) = "FORWARD" Then
        msg = msg & vbCrLf & "To:        " & CStr(routing("outlookTo"))
        If Len(CStr(routing("outlookCc"))) > 0 Then
            msg = msg & vbCrLf & "CC:        " & CStr(routing("outlookCc"))
        End If
        msg = msg & vbCrLf & vbCrLf & "Forward draft opened — review and click Send."
    End If

    BuildSummaryMessage = msg
End Function

Private Function BuildNoForwardMessage(result As Object) As String
    Dim routing As Object
    Set routing = result("routing")
    BuildNoForwardMessage = "No forward needed." & vbCrLf & vbCrLf & CStr(routing("reason"))
End Function

Private Function BuildReviewMessage(result As Object) As String
    Dim routing As Object
    Set routing = result("routing")
    BuildReviewMessage = "Manual review required." & vbCrLf & vbCrLf & CStr(routing("reason"))
End Function

Private Sub WriteUtf8(filePath As String, content As String)
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText content
    stream.SaveToFile filePath, 2
    stream.Close
End Sub

Private Function ParseJsonFile(path As String) As Object
    Dim stream As Object
    Dim json As String

    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.LoadFromFile path
    json = stream.ReadText
    stream.Close

    Set ParseJsonFile = ParseJsonSimple(json)
End Function

Private Function ParseJsonSimple(json As String) As Object
    Dim dict As Object
    Set dict = CreateObject("Scripting.Dictionary")

    dict("ok") = (InStr(json, """ok"": true") > 0 Or InStr(json, """ok"":true") > 0)
    dict("error") = JsonStringValue(json, "error")
    dict("submitterEmail") = JsonStringValue(json, "submitterEmail")

    Dim decision As Object
    Set decision = CreateObject("Scripting.Dictionary")
    decision("kind") = JsonStringValue(json, "kind")
    decision("category") = JsonStringValue(json, "category")
    decision("score") = JsonNumberValue(json, "score")
    decision("reasoning") = JsonStringValue(json, "reasoning")
    Set dict("decision") = decision

    Dim routing As Object
    Set routing = CreateObject("Scripting.Dictionary")
    routing("action") = JsonRoutingAction(json)
    routing("outlookTo") = JsonStringValue(json, "outlookTo")
    routing("outlookCc") = JsonStringValue(json, "outlookCc")
    routing("reason") = JsonStringValue(json, "reason")
    routing("guidanceNote") = JsonStringValue(json, "guidanceNote")
    Set dict("routing") = routing

    Set ParseJsonSimple = dict
End Function

Private Function JsonStringValue(json As String, key As String) As String
    Dim re As Object
    Dim matches As Object

    Set re = CreateObject("VBScript.RegExp")
    re.Global = False
    re.IgnoreCase = True
    re.pattern = """" & key & """\s*:\s*""((?:\\""|[^""])*)"""

    Set matches = re.Execute(json)
    If matches.Count = 0 Then
        JsonStringValue = ""
        Exit Function
    End If

    JsonStringValue = UnescapeJson(matches(0).SubMatches(0))
End Function

Private Function JsonNumberValue(json As String, key As String) As Double
    Dim re As Object
    Dim matches As Object

    Set re = CreateObject("VBScript.RegExp")
    re.Global = False
    re.pattern = """" & key & """\s*:\s*([0-9.]+)"

    Set matches = re.Execute(json)
    If matches.Count = 0 Then
        JsonNumberValue = 0
        Exit Function
    End If

    JsonNumberValue = CDbl(matches(0).SubMatches(0))
End Function

Private Function JsonRoutingAction(json As String) As String
    Dim re As Object
    Dim matches As Object

    Set re = CreateObject("VBScript.RegExp")
    re.Global = False
    re.pattern = """routing""\s*:\s*\{([^}]+)\}"
    Set matches = re.Execute(json)
    If matches.Count = 0 Then
        JsonRoutingAction = "REVIEW_QUEUE"
        Exit Function
    End If

    JsonRoutingAction = JsonStringValue("{" & matches(0).SubMatches(0) & "}", "action")
End Function

Private Function UnescapeJson(s As String) As String
    UnescapeJson = Replace(Replace(Replace(s, "\""", """"), "\n", vbCrLf), "\/", "/")
End Function
