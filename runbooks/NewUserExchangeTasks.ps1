Param(
     [parameter (Mandatory=$true)]
     [String]$upn,
     [parameter (Mandatory=$true)]
     [Boolean]$fulltime,
     [parameter (Mandatory=$true)]
     [String]$department
)

$sig_group = $null
if ($department -like "Stockton*") {
    $sig_group = "sigv2_stockton"}
else {
    if ($department -like "Arena*" -Or $department -like "AV" -Or $department -like "Technology*") {
        $sig_group = "sigv2_g1c" }
    else { 
        $sig_group = "sigv2_thesawyer"}
        if ($department -like "Basketball*") { 
            $sig_group = "sigv2_basketballops"}
    }


#Connect-ExchangeOnline -Certificate $cert -AppId "00e3f1f7-c34d-4588-b8d2-1bc766cb7c0d" -Organization "sacramentokings.onmicrosoft.com"
#Connect-ExchangeOnline -Credential $credential -Organization "sacramentokings.onmicrosoft.com"

$tenantId = "f4b24903-3e53-44b6-a33e-24597567c14e"
$clientId = "00e3f1f7-c34d-4588-b8d2-1bc766cb7c0d"
$clientSecret = "sio8Q~Y1FgjgjriCDYIqICh1O.mp6d4AdWSzWaiE"
$scope = "https://outlook.office365.com/.default"

$tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
    -Body @{
        client_id     = $clientId
        scope         = $scope
        client_secret = $clientSecret
        grant_type    = "client_credentials"
    }

$accessToken = $tokenResponse.access_token

Connect-ExchangeOnline -AccessToken $accessToken -Organization "sacramentokings.onmicrosoft.com"
#Write $tokenResponse

$mbuser = $null
    do {
       try{
           $mbuser = Get-EXOMailbox -UserPrincipalName $upn 
        
         }catch {
            Write-Host "Not Found"
            Start-Sleep 60
        }
    } while ($mbuser -eq $null)    

    if ($user.department -eq "Rivercats") {
        
        if($fulltime) {Add-DistributionGroupMember -Identity rivercats@rivercats.com -Member $upn}
        Add-DistributionGroupMember -Identity rcb_staff@rivercats.com -Member $upn
        } 
    else {
        if ($department -like "Basketball*") {Add-DistributionGroupMember -Identity BasketballOperations@kings.com -Member $upn}
        else { Add-DistributionGroupMember -Identity "allteammembers@kings.com" -Member $upn }
        Add-DistributionGroupMember -Identity $sig_group -Member $upn
        if ($fulltime) { Add-DistributionGroupMember -Identity "HR Distribution" -Member $upn }
    }

Disconnect-ExchangeOnline -Confirm:$false


#write to welcome email logic app
$tenantId = "f4b24903-3e53-44b6-a33e-24597567c14e"
$clientId = "19d50aa6-ce7d-4262-a25e-b2a626f56d77"
$clientSecret = "WeY8Q~RPaQbilAel9jRPmsVrsRT9Co6F11ky1c7n"
$storageAccountName = "kingsnewaccounts"
$queueName = "newaccounts"
$message = @{
    Name = $user.firstname
    LastName = $user.lastname
    Email = $user.upn
    PartitionKey = "h39874"
    RowKey = $user.upn + (Get-Date).ToString('MM-dd-yyyy')
    Title = $user.title
    Department = $user.department
} | ConvertTo-Json -Depth 10

# Get OAuth 2.0 token for Azure Storage API
$body = @{
    grant_type    = "client_credentials"
    client_id     = $clientId
    client_secret = $clientSecret
    scope         = "https://storage.azure.com/.default"
}

$tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -ContentType "application/x-www-form-urlencoded" -Body $body
$accessToken = $tokenResponse.access_token

# Construct the Queue URI for adding a message
$queueUri = "https://$storageAccountName.queue.core.windows.net/$queueName/messages"

# Encode the message in base64 (required by the Queue API)
$encodedMessage = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($message))

# Prepare the body and headers for the request
$body = @"
<QueueMessage>
    <MessageText>$encodedMessage</MessageText>
</QueueMessage>
"@
$headers = @{
    "Authorization" = "Bearer $accessToken"
    "x-ms-version" = "2021-08-06"
    "Content-Type"  = "application/xml"
}

# Send the message to the queue
$response = Invoke-RestMethod -Uri $queueUri -Method Post -Headers $headers -Body $body
#Write-Output "Message pushed to queue successfully.
